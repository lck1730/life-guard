"""上线前的静态检查：**专找那种"语法过了、import 也过了，但一跑就炸"的东西。**

## 为什么需要它

2026-10-06 的一次事故。agent 改 `orchestrator/agent.py` 时写了：

    from ..db import fetch_sync        ← 这个函数**不存在**（我们的 db 是异步的）
    await _idle_status(group_id)       ← 这个函数**从没定义过**

`compileall` 过 ✓ `import app.main` 也过 ✓ —— **因为那个 import 写在一个函数里面**
✗ 模块导入时不执行它 ✓ 于是服务**正常起来了** ✓

**而每一轮跑到那儿就炸** ✗ 从 01:31 瘫到 10:30 ✓
用户看到的是「一直在思考中」，而且**群里一点痕迹都没有** ✗

## 它查两件事（正好是那两个 bug）

1. **调用了但没定义的名字** —— `_idle_status(...)`
2. **`from X import Y` 里，X 或 Y 根本不存在** —— `fetch_sync`

## 边界（别指望它是全部）

这是**静态**检查 ✗ —— 堵不住类型错、逻辑错、`None` 崩溃。
但它便宜、无副作用（只解析 + 导入自己的模块），
正好堵住"**改后端最容易犯的那一类**"：名字写错、忘了定义、import 了个不存在的东西。

顺带一提，这一条本该早就有的 —— `restart_backend` 原来只查"语法 + 能不能 import"，
而 2026-10-04 那次 `asyncio.create_task` 被 GC 的假成功，也是这两道挡不住的那一类 ✗
"""

from __future__ import annotations

import ast
import builtins
import importlib
import pathlib
import sys

APP_DIR = pathlib.Path(__file__).resolve().parent
BUILTINS = set(dir(builtins))

# 用 `python app/preflight.py` 直接跑时，`sys.path[0]` 是 `app/` 而不是仓库根 ✗，
# 于是 `import app.db` 会被当成"**app 这个包不存在**" ✗ —— 假故障，还会指着
# 一堆无辜的文件报错。自检里用的是 `-m app.preflight` ✓（那样 cwd 在 path 里 ✓），
# 这里补一手，免得谁手敲一次就被自己骗了。
_ROOT = str(APP_DIR.parent)
if _ROOT not in sys.path:
    sys.path.insert(0, _ROOT)


def _bound_names(tree: ast.AST) -> set[str]:
    """这个模块里"看得见"的所有名字：定义、赋值、import、参数、推导式变量…"""
    names = set(BUILTINS)
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            names.add(n.name)
            a = getattr(n, "args", None)
            if a is not None:
                for x in list(a.args) + list(a.posonlyargs) + list(a.kwonlyargs):
                    names.add(x.arg)
                if a.vararg:
                    names.add(a.vararg.arg)
                if a.kwarg:
                    names.add(a.kwarg.arg)
        elif isinstance(n, ast.Lambda):
            for x in list(n.args.args) + list(n.args.posonlyargs) + list(n.args.kwonlyargs):
                names.add(x.arg)
        elif isinstance(n, ast.Name) and isinstance(n.ctx, (ast.Store, ast.Del)):
            names.add(n.id)
        elif isinstance(n, ast.arg):
            names.add(n.arg)
        elif isinstance(n, ast.alias):
            names.add((n.asname or n.name).split(".")[0])
        elif isinstance(n, ast.ExceptHandler) and n.name:
            names.add(n.name)
        elif isinstance(n, ast.Global):
            names.update(n.names)
    return names


#: 模块自带的那些名字（`__file__` 等）不在 `builtins` 里 ✓ ——
#: 不补的话，任何用了 `Path(__file__)` 的文件都会被误报 ✓。
_MODULE_DUNDERS = {"__file__", "__name__", "__doc__", "__package__", "__spec__", "__loader__"}


def _annotation_nodes(tree: ast.AST) -> set[int]:
    """注解里的名字**不算运行时引用** ✓。

    `from __future__ import annotations` 之后注解不会在导入时求值 ✗ ——
    所以 `def f(x: Any)` 里没 import 的 `Any` 不会炸 ✓，这里也不该报 ✓。
    """
    ids: set[int] = set()
    for n in ast.walk(tree):
        ann = None
        if isinstance(n, ast.arg):
            ann = n.annotation
        elif isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            ann = n.returns
        elif isinstance(n, ast.AnnAssign):
            ann = n.annotation
        if ann is not None:
            ids.update(id(x) for x in ast.walk(ann))
    return ids


def _check_imports(tree: ast.AST, dotted: str) -> list[str]:
    """`from X import Y` 里的 X 和 Y 到底存不存在。

    只查 `app.*`（我们自己）✓ —— 第三方的**不去 import**，免得有副作用或拖慢。
    """
    bad: list[str] = []
    pkg = dotted.split(".")[:-1]          # app.orchestrator.agent → ['app','orchestrator']
    for n in ast.walk(tree):
        if not isinstance(n, ast.ImportFrom):
            continue
        if n.level:                        # 相对导入：往上 level-1 层
            up = n.level - 1
            if up > len(pkg):
                continue
            base = pkg[: len(pkg) - up] if up else pkg
            mod = ".".join(base + ([n.module] if n.module else []))
        else:
            mod = n.module or ""
        if not mod.startswith("app"):
            continue
        try:
            m = importlib.import_module(mod)
        except ModuleNotFoundError as exc:
            # ⚠️ **缺的是第三方依赖时跳过。**
            # 本机没装 venv 的话（比如我在自己电脑上跑这个检查 ✗），
            # `app.db` 会因为 `aiosqlite` 缺失而导不进来 ✓ —— 那不是代码的问题 ✓
            # 只有**我们自己**（app.*）的名字找不到，才是真问题。
            if not (exc.name or "").startswith("app"):
                continue
            bad.append(f"`from {mod} import …` —— **这个模块导不进来**：{exc}")
            continue
        except Exception as exc:           # noqa: BLE001
            bad.append(f"`from {mod} import …` —— **这个模块导不进来**：{exc}")
            continue
        for a in n.names:
            if a.name == "*":
                continue
            if hasattr(m, a.name):
                continue
            # `from app import records` 这种**子模块**：属性要等它被导入过才出现 ✗
            # 所以 hasattr 说没有时，还得试着当子模块导一次 ✓
            try:
                importlib.import_module(f"{mod}.{a.name}")
                continue
            except ModuleNotFoundError as exc:
                if not (exc.name or "").startswith("app"):
                    continue           # 又是依赖缺失（同一把尺子，见上）
            except Exception:          # noqa: BLE001
                pass
            bad.append(f"`from {mod} import {a.name}` —— **{mod} 里没有 `{a.name}`**")
    return bad


def check() -> list[str]:
    problems: list[str] = []
    for f in sorted(APP_DIR.rglob("*.py")):
        if "__pycache__" in f.parts or f.name == "preflight.py":
            continue
        src = f.read_text(encoding="utf-8", errors="replace")
        rel = f.relative_to(APP_DIR.parent)
        try:
            tree = ast.parse(src)
        except SyntaxError as e:
            problems.append(f"{rel}:{e.lineno} **语法错**：{e.msg}")
            continue

        bound = _bound_names(tree) | _MODULE_DUNDERS
        annotations = _annotation_nodes(tree)
        for n in ast.walk(tree):
            # ★ **查所有"读这个名字"的地方，不只查函数调用。**
            #
            # 2026-10-22 的教训：拿掉了 DIY 那套代码时把模块级常量 `_SPLIT_RE`
            # 一起删了 ✗，但 `_split_parts()` 里还写着 `_SPLIT_RE.split(text)` ✓。
            # 它不是 `xxx()` 的调用形式 ✗，原来这道检查**看不见** ✗ ——
            # 部署自检全过、服务正常起来，然后**每一轮回复都在最后一步炸掉** ✗
            # （用户连收两条「中途失败了」）✓。
            #
            # 现在按"任何一次读取"来查 ✓：变量、常量、函数名一视同仁 ✓。
            if (isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)
                    and n.id not in bound and id(n) not in annotations):
                problems.append(f"{rel}:{n.lineno} 引用了 `{n.id}` —— **这个名字没定义**")
        problems += [f"{rel}: {x}" for x in _check_imports(tree, ".".join(rel.with_suffix("").parts))]
    return problems


def main() -> int:
    problems = check()
    if problems:
        print(f"静态检查没过（{len(problems)} 处）：")
        for p in problems:
            print("  ✗", p)
        return 1
    print("静态检查通过：没有未定义的名字，import 也都在")
    return 0


if __name__ == "__main__":
    sys.exit(main())
