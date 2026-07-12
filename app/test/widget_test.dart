import 'package:ai_video_maker/core/models/token_balance.dart';
import 'package:ai_video_maker/core/repositories/token_repository.dart';
import 'package:ai_video_maker/design_system/components/skeleton_box.dart';
import 'package:ai_video_maker/design_system/theme/app_theme.dart';
import 'package:ai_video_maker/features/characters/screens/character_screen.dart';
import 'package:ai_video_maker/features/characters/providers/character_providers.dart';
import 'package:ai_video_maker/features/catalog/providers/catalog_providers.dart';
import 'package:ai_video_maker/features/history/screens/history_screen.dart';
import 'package:ai_video_maker/features/home/providers/home_providers.dart';
import 'package:ai_video_maker/features/home/screens/home_screen.dart';
import 'package:ai_video_maker/features/notifications/providers/notification_providers.dart';
import 'package:ai_video_maker/features/shell/app_navigation.dart';
import 'package:ai_video_maker/features/shell/authenticated_shell.dart';
import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';

void main() {
  test('light and dark themes expose semantic design tokens', () {
    for (final theme in [AppTheme.light, AppTheme.dark]) {
      expect(theme.useMaterial3, isTrue);
      expect(theme.extension<AppThemeTokens>(), isNotNull);
      expect(
        theme.extension<AppThemeTokens>()!.generationGradient.colors,
        hasLength(2),
      );
    }
    expect(AppTheme.light.brightness, Brightness.light);
    expect(AppTheme.dark.brightness, Brightness.dark);
  });

  testWidgets('compact navigation exposes exactly three destinations', (
    tester,
  ) async {
    var selected = 0;
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.light,
        home: Scaffold(
          bottomNavigationBar: AppBottomNavigation(
            currentIndex: selected,
            onDestinationSelected: (value) => selected = value,
          ),
        ),
      ),
    );

    expect(find.byType(NavigationDestination), findsNWidgets(3));
    expect(find.text('Home'), findsOneWidget);
    expect(find.text('Character'), findsOneWidget);
    expect(find.text('History'), findsOneWidget);
    await tester.tap(find.text('History'));
    expect(selected, 2);
  });

  testWidgets('Home empty state has no overflow at 375x812', (tester) async {
    _setViewport(tester, const Size(375, 812));
    await tester.pumpWidget(_shellApp());
    await tester.pumpAndSettle();

    expect(find.text('New formats are on the way'), findsOneWidget);
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('compact Home remains overflow-free at 1.5x text scale', (
    tester,
  ) async {
    _setViewport(tester, const Size(375, 812));
    await tester.pumpWidget(_shellApp(textScale: 1.5));
    await tester.pumpAndSettle();

    expect(find.text('VIDEO STUDIO'), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('shell changes navigation at the exact 760 breakpoint', (
    tester,
  ) async {
    _setViewport(tester, const Size(759, 900));
    await tester.pumpWidget(_shellApp());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationBar), findsOneWidget);
    expect(find.byType(NavigationRail), findsNothing);

    _setViewport(tester, const Size(760, 900));
    await tester.pumpWidget(_shellApp());
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(find.byType(NavigationBar), findsNothing);

    _setViewport(tester, const Size(1024, 900));
    await tester.pumpWidget(_shellApp(theme: AppTheme.dark));
    await tester.pumpAndSettle();
    expect(find.byType(NavigationRail), findsOneWidget);
    expect(tester.takeException(), isNull);
  });

  testWidgets('indexed branch keeps Home scroll state when switching tabs', (
    tester,
  ) async {
    _setViewport(tester, const Size(375, 700));
    await tester.pumpWidget(_shellApp());
    await tester.pumpAndSettle();

    await tester.drag(find.byType(CustomScrollView), const Offset(0, -260));
    await tester.pumpAndSettle();
    final before = tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .pixels;
    expect(before, greaterThan(0));

    await tester.tap(find.text('Character'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Home'));
    await tester.pumpAndSettle();

    final after = tester
        .state<ScrollableState>(find.byType(Scrollable).first)
        .position
        .pixels;
    expect(after, closeTo(before, 0.1));
  });

  testWidgets('reduced-motion skeleton constructs without animation errors', (
    tester,
  ) async {
    await tester.pumpWidget(
      MaterialApp(
        theme: AppTheme.dark,
        home: Builder(
          builder: (context) => MediaQuery(
            data: MediaQuery.of(context).copyWith(disableAnimations: true),
            child: const Scaffold(body: SkeletonBox(height: 100)),
          ),
        ),
      ),
    );
    await tester.pump(const Duration(seconds: 1));
    expect(tester.takeException(), isNull);
  });
}

Widget _shellApp({ThemeData? theme, double textScale = 1}) {
  final router = GoRouter(
    initialLocation: '/home',
    routes: [
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
        path: '/tokens',
        builder: (context, state) => const Scaffold(body: Text('Tokens')),
      ),
      GoRoute(
        path: '/notifications',
        builder: (context, state) =>
            const Scaffold(body: Text('Notifications')),
      ),
      GoRoute(
        path: '/create/templates',
        builder: (context, state) => const Scaffold(body: Text('Create')),
      ),
    ],
  );
  return ProviderScope(
    overrides: [
      tokenBalanceProvider.overrideWith(
        (ref) async => const TokenBalance(tokens: 120),
      ),
      projectListProvider.overrideWith((ref) async => []),
      catalogCategoriesProvider.overrideWith((ref) async => []),
      notificationListProvider.overrideWith((ref) async => []),
      characterHubProvider.overrideWith(() => _EmptyCharacterHubController()),
    ],
    child: MaterialApp.router(
      theme: theme ?? AppTheme.light,
      routerConfig: router,
      builder: (context, child) => MediaQuery(
        data: MediaQuery.of(
          context,
        ).copyWith(textScaler: TextScaler.linear(textScale)),
        child: child!,
      ),
    ),
  );
}

class _EmptyCharacterHubController extends CharacterHubController {
  @override
  Future<CharacterHubState> build() async => const CharacterHubState();
}

void _setViewport(WidgetTester tester, Size size) {
  tester.view.devicePixelRatio = 1;
  tester.view.physicalSize = size;
  addTearDown(tester.view.resetDevicePixelRatio);
  addTearDown(tester.view.resetPhysicalSize);
}
