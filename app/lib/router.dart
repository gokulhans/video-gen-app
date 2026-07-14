import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import 'core/auth_repository.dart';
import 'features/auth/screens/onboarding_screen.dart';
import 'features/auth/screens/sign_in_screen.dart';
import 'features/auth/screens/sign_up_screen.dart';
import 'features/create/screens/generation_progress_screen.dart';
import 'features/create/screens/generation_job_screen.dart';
import 'features/create/screens/generation_result_screen.dart';
import 'features/catalog/screens/template_detail_screen.dart';
import 'features/create/screens/template_picker_screen.dart';
import 'features/create/screens/topic_form_screen.dart';
import 'features/editor/screens/editor_screen.dart';
import 'features/characters/screens/character_screen.dart';
import 'features/history/screens/history_screen.dart';
import 'features/history/screens/legacy_projects_screen.dart';
import 'features/home/screens/home_screen.dart';
import 'features/notifications/screens/notifications_screen.dart';
import 'features/render/screens/render_options_screen.dart';
import 'features/render/screens/render_progress_screen.dart';
import 'features/render/screens/video_result_screen.dart';
import 'features/tokens/screens/purchase_screen.dart';
import 'features/tokens/screens/token_balance_screen.dart';
import 'features/shell/authenticated_shell.dart';
import 'features/brands/screens/brand_kits_screen.dart';
import 'features/settings/screens/settings_screen.dart';

/// Global navigator key for navigation outside an individual page context.
final rootNavigatorKey = GlobalKey<NavigatorState>();

final routerProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    navigatorKey: rootNavigatorKey,
    initialLocation: '/sign-in',
    redirect: (context, state) {
      final authAsync = ref.read(authStateProvider);
      final signedIn = authAsync.valueOrNull != null;
      final loggingIn =
          state.matchedLocation == '/sign-in' ||
          state.matchedLocation == '/sign-up' ||
          state.matchedLocation == '/onboarding';

      // While the auth state is still resolving, don't redirect yet.
      if (authAsync.isLoading) return null;

      if (!signedIn && !loggingIn) return '/sign-in';
      if (signedIn &&
          (state.matchedLocation == '/sign-in' ||
              state.matchedLocation == '/sign-up')) {
        return '/home';
      }
      return null;
    },
    refreshListenable: GoRouterRefreshStream(ref),
    routes: [
      GoRoute(
        path: '/sign-in',
        builder: (context, state) => const SignInScreen(),
      ),
      GoRoute(
        path: '/sign-up',
        builder: (context, state) => const SignUpScreen(),
      ),
      GoRoute(
        path: '/onboarding',
        builder: (context, state) => const OnboardingScreen(),
      ),
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) =>
            AuthenticatedShell(navigationShell: navigationShell),
        branches: [
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/home',
                builder: (context, state) => const HomeScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/characters',
                builder: (context, state) => const CharacterScreen(),
              ),
            ],
          ),
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/history',
                builder: (context, state) => const HistoryScreen(),
              ),
            ],
          ),
        ],
      ),
      GoRoute(
        path: '/create/templates',
        builder: (context, state) => const TemplatePickerScreen(),
      ),
      GoRoute(
        path: '/templates/:slugOrId',
        builder: (context, state) =>
            TemplateDetailScreen(slugOrId: state.pathParameters['slugOrId']!),
      ),
      GoRoute(
        path: '/generation/:jobId',
        builder: (context, state) =>
            GenerationJobScreen(jobId: state.pathParameters['jobId']!),
      ),
      GoRoute(
        path: '/generation/:jobId/result/:assetId',
        builder: (context, state) => GenerationResultScreen(
          jobId: state.pathParameters['jobId']!,
          assetId: state.pathParameters['assetId']!,
        ),
      ),
      GoRoute(
        path: '/legacy/projects',
        builder: (context, state) => const LegacyProjectsScreen(),
      ),
      GoRoute(
        path: '/create/topic',
        builder: (context, state) => const TopicFormScreen(),
      ),
      GoRoute(
        path: '/create/progress/:projectId',
        builder: (context, state) => GenerationProgressScreen(
          projectId: state.pathParameters['projectId']!,
        ),
      ),
      GoRoute(
        path: '/editor/:projectId',
        builder: (context, state) =>
            EditorScreen(projectId: state.pathParameters['projectId']!),
      ),
      GoRoute(
        path: '/render/:projectId',
        builder: (context, state) =>
            RenderOptionsScreen(projectId: state.pathParameters['projectId']!),
      ),
      GoRoute(
        path: '/render/progress/:jobId',
        builder: (context, state) =>
            RenderProgressScreen(jobId: state.pathParameters['jobId']!),
      ),
      GoRoute(
        path: '/render/result/:jobId',
        builder: (context, state) =>
            VideoResultScreen(jobId: state.pathParameters['jobId']!),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) => const NotificationsScreen(),
      ),
      GoRoute(
        path: '/brands',
        builder: (context, state) => const BrandKitsScreen(),
      ),
      GoRoute(
        path: '/settings',
        builder: (context, state) => const SettingsScreen(),
      ),
      GoRoute(
        path: '/tokens',
        builder: (context, state) => const TokenBalanceScreen(),
      ),
      GoRoute(
        path: '/tokens/purchase',
        builder: (context, state) => const PurchaseScreen(),
      ),
    ],
  );
});

/// Bridges Riverpod's [authStateProvider] into a [Listenable] so go_router's
/// `refreshListenable` re-evaluates redirects whenever auth state changes.
class GoRouterRefreshStream extends ChangeNotifier {
  GoRouterRefreshStream(Ref ref) {
    ref.listen(authStateProvider, (previous, next) => notifyListeners());
  }
}
