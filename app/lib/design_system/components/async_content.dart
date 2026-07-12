import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import 'empty_state.dart';
import 'error_state.dart';
import 'skeleton_box.dart';

class AsyncContent<T> extends StatelessWidget {
  const AsyncContent({
    super.key,
    required this.value,
    required this.dataBuilder,
    this.isEmpty,
    this.empty,
    this.loading,
    this.onRetry,
  });

  final AsyncValue<T> value;
  final Widget Function(BuildContext context, T data) dataBuilder;
  final bool Function(T data)? isEmpty;
  final Widget? empty;
  final Widget? loading;
  final VoidCallback? onRetry;

  @override
  Widget build(BuildContext context) => value.when(
    skipLoadingOnRefresh: true,
    data: (data) {
      if (isEmpty?.call(data) ?? false) {
        return empty ??
            const EmptyState(
              icon: Icons.inbox_outlined,
              title: 'Nothing here yet',
              message: 'New content will appear here when it is available.',
            );
      }
      return dataBuilder(context, data);
    },
    loading: () => loading ?? const _DefaultLoading(),
    error: (error, stackTrace) {
      debugPrint('AsyncContent failed: $error\n$stackTrace');
      return ErrorState(
        message: 'We could not load this content. Please try again.',
        onRetry: onRetry,
      );
    },
  );
}

class _DefaultLoading extends StatelessWidget {
  const _DefaultLoading();

  @override
  Widget build(BuildContext context) {
    return const Column(
      children: [
        SkeletonBox(height: 112),
        SizedBox(height: 12),
        SkeletonBox(height: 112),
        SizedBox(height: 12),
        SkeletonBox(height: 112),
      ],
    );
  }
}
