import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../core/repositories/token_repository.dart';
import '../../design_system/components/app_top_bar.dart';
import '../../design_system/components/credit_pill.dart';
import '../../design_system/tokens/app_breakpoints.dart';
import '../../design_system/tokens/app_colors.dart';
import '../../design_system/tokens/app_radii.dart';
import '../../design_system/tokens/app_spacing.dart';
import '../auth/providers/auth_controller.dart';
import '../notifications/providers/notification_providers.dart';
import 'app_navigation.dart';

class AuthenticatedShell extends ConsumerWidget {
  const AuthenticatedShell({super.key, required this.navigationShell});

  final StatefulNavigationShell navigationShell;

  void _goToBranch(int index) {
    navigationShell.goBranch(
      index,
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final balance = ref.watch(tokenBalanceProvider);
    final unreadNotifications =
        ref.watch(unreadNotificationCountProvider).valueOrNull ?? 0;
    return LayoutBuilder(
      builder: (context, constraints) {
        final wide = constraints.maxWidth >= AppBreakpoints.navigationRail;
        return Scaffold(
          appBar: AppTopBar(
            title: const _BrandMark(),
            showDivider: true,
            actions: [
              CreditPill(
                balance: balance.valueOrNull?.tokens,
                isLoading: balance.isLoading,
                hasError: balance.hasError,
                onTap: () => context.push('/tokens'),
              ),
              const SizedBox(width: AppSpacing.xxs),
              IconButton(
                tooltip: unreadNotifications == 0
                    ? 'Notifications'
                    : 'Notifications, $unreadNotifications unread',
                onPressed: () => context.push('/notifications'),
                icon: Badge.count(
                  count: unreadNotifications,
                  isLabelVisible: unreadNotifications > 0,
                  child: const Icon(Icons.notifications_none_rounded),
                ),
              ),
              _AccountMenu(
                onSignOut: () =>
                    ref.read(authControllerProvider.notifier).signOut(),
              ),
            ],
          ),
          body: wide
              ? Row(
                  children: [
                    AppNavigationRail(
                      currentIndex: navigationShell.currentIndex,
                      onDestinationSelected: _goToBranch,
                    ),
                    VerticalDivider(
                      width: 1,
                      color: Theme.of(context).colorScheme.outlineVariant,
                    ),
                    Expanded(child: navigationShell),
                  ],
                )
              : navigationShell,
          bottomNavigationBar: wide
              ? null
              : AppBottomNavigation(
                  currentIndex: navigationShell.currentIndex,
                  onDestinationSelected: _goToBranch,
                ),
        );
      },
    );
  }
}

class _BrandMark extends StatelessWidget {
  const _BrandMark();

  @override
  Widget build(BuildContext context) {
    return Row(
      mainAxisSize: MainAxisSize.min,
      children: [
        DecoratedBox(
          decoration: const BoxDecoration(
            gradient: LinearGradient(
              colors: [AppColors.generationStart, AppColors.generationEnd],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.all(Radius.circular(AppRadii.control)),
          ),
          child: const SizedBox.square(
            dimension: 38,
            child: Icon(
              Icons.play_arrow_rounded,
              color: Colors.white,
              size: 26,
            ),
          ),
        ),
        const SizedBox(width: AppSpacing.sm),
        Flexible(
          child: Text(
            'AI Video',
            overflow: TextOverflow.fade,
            softWrap: false,
            style: Theme.of(context).textTheme.titleMedium,
          ),
        ),
      ],
    );
  }
}

class _AccountMenu extends StatelessWidget {
  const _AccountMenu({required this.onSignOut});

  final VoidCallback onSignOut;

  @override
  Widget build(BuildContext context) {
    return PopupMenuButton<String>(
      tooltip: 'Account menu',
      onSelected: (value) {
        if (value == 'sign-out') onSignOut();
        if (value == 'brands') context.push('/brands');
        if (value == 'settings') context.push('/settings');
      },
      itemBuilder: (context) => const [
        PopupMenuItem(
          value: 'brands',
          child: Row(
            children: [
              Icon(Icons.palette_outlined),
              SizedBox(width: AppSpacing.sm),
              Text('Brand kits'),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'settings',
          child: Row(
            children: [
              Icon(Icons.settings_outlined),
              SizedBox(width: AppSpacing.sm),
              Text('Settings'),
            ],
          ),
        ),
        PopupMenuItem(
          value: 'sign-out',
          child: Row(
            children: [
              Icon(Icons.logout_rounded),
              SizedBox(width: AppSpacing.sm),
              Text('Sign out'),
            ],
          ),
        ),
      ],
      child: Padding(
        padding: const EdgeInsets.all(AppSpacing.xxs),
        child: CircleAvatar(
          radius: 18,
          backgroundColor: Theme.of(context).colorScheme.surfaceContainerHigh,
          child: Icon(
            Icons.person_outline_rounded,
            size: 20,
            color: Theme.of(context).colorScheme.onSurfaceVariant,
          ),
        ),
      ),
    );
  }
}
