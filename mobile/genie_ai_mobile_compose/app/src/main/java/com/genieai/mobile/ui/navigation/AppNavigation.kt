package com.genieai.mobile.ui.navigation

import androidx.compose.runtime.Composable
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.compose.rememberNavController
import androidx.navigation.navArgument
import com.genieai.mobile.ui.screens.auth.*
import com.genieai.mobile.ui.screens.main.MainScreen
import com.genieai.mobile.ui.screens.profile.UserProfileScreen
import com.genieai.mobile.ui.screens.settings.AboutScreen
import com.genieai.mobile.ui.screens.settings.SettingsScreen

object Routes {
    const val LOGIN = "login"
    const val REGISTER = "register"
    const val REGISTRATION_SUCCESS = "registration-success/{email}"
    const val PASSWORD_RESET = "password-reset"
    const val PASSWORD_RESET_CONFIRM = "password-reset-confirm"
    const val MAIN = "main"
    const val PROFILE = "profile"
    const val SETTINGS = "settings"
    const val ABOUT = "about"

    fun registrationSuccess(email: String) = "registration-success/$email"
}

@Composable
fun AppNavigation(
    navController: NavHostController = rememberNavController()
) {
    NavHost(
        navController = navController,
        startDestination = Routes.LOGIN
    ) {
        composable(Routes.LOGIN) {
            LoginScreen(
                onLoginSuccess = {
                    navController.navigate(Routes.MAIN) {
                        popUpTo(Routes.LOGIN) { inclusive = true }
                    }
                },
                onNavigateToRegister = {
                    navController.navigate(Routes.REGISTER)
                },
                onNavigateToPasswordReset = {
                    navController.navigate(Routes.PASSWORD_RESET)
                }
            )
        }

        composable(Routes.REGISTER) {
            RegisterScreen(
                onRegistrationSuccess = { email ->
                    navController.navigate(Routes.registrationSuccess(email)) {
                        popUpTo(Routes.REGISTER) { inclusive = true }
                    }
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                }
            )
        }

        composable(
            route = Routes.REGISTRATION_SUCCESS,
            arguments = listOf(navArgument("email") { type = NavType.StringType })
        ) { backStackEntry ->
            val email = backStackEntry.arguments?.getString("email") ?: ""
            RegistrationSuccessScreen(
                email = email,
                onNavigateToLogin = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.PASSWORD_RESET) {
            PasswordResetScreen(
                onNavigateToConfirm = {
                    navController.navigate(Routes.PASSWORD_RESET_CONFIRM)
                },
                onNavigateToLogin = {
                    navController.popBackStack()
                }
            )
        }

        composable(Routes.PASSWORD_RESET_CONFIRM) {
            PasswordResetConfirmScreen(
                onResetSuccess = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                },
                onNavigateToLogin = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.MAIN) {
            MainScreen(
                onNavigateToProfile = { navController.navigate(Routes.PROFILE) },
                onNavigateToSettings = { navController.navigate(Routes.SETTINGS) },
                onNavigateToAbout = { navController.navigate(Routes.ABOUT) },
                onLogout = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.PROFILE) {
            UserProfileScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Routes.SETTINGS) {
            SettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onLogout = {
                    navController.navigate(Routes.LOGIN) {
                        popUpTo(0) { inclusive = true }
                    }
                }
            )
        }

        composable(Routes.ABOUT) {
            AboutScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }
    }
}
