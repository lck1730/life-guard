// 仓库全部走阿里云镜像。
//
// 原因：本机 maven.google.com 超时（AGP、AndroidX 都从那里来），
// repo1.maven.org 和 services.gradle.org 则正常。阿里云有 google 的完整镜像，
// 所以把镜像放在前面、官方源留作兜底——万一你在能直连的网络上也能跑。
pluginManagement {
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        maven("https://maven.aliyun.com/repository/gradle-plugin")
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.PREFER_SETTINGS)
    repositories {
        maven("https://maven.aliyun.com/repository/google")
        maven("https://maven.aliyun.com/repository/public")
        google()
        mavenCentral()
    }
}

rootProject.name = "LifeGuard"
include(":app")
