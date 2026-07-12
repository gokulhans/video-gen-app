import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/models/token_balance.dart';
import '../../../core/repositories/token_repository.dart';

final tokenHistoryProvider = FutureProvider.autoDispose<List<TokenTransaction>>(
  (ref) async {
    return ref.watch(tokenRepositoryProvider).getHistory();
  },
);
