import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../core/api_client.dart';
import '../../../core/auth_repository.dart';
import '../../../core/models/user.dart';

enum AuthActionStatus { idle, loading, success, error }

class AuthActionState {
  const AuthActionState({
    this.status = AuthActionStatus.idle,
    this.errorMessage,
  });

  final AuthActionStatus status;
  final String? errorMessage;

  bool get isLoading => status == AuthActionStatus.loading;

  AuthActionState copyWith({AuthActionStatus? status, String? errorMessage}) =>
      AuthActionState(
        status: status ?? this.status,
        errorMessage: errorMessage,
      );
}

/// Drives sign-in/sign-up/google/sign-out actions and bumps
/// [authTokenRevisionProvider] so [authStateProvider] and [dioProvider]
/// pick up the new session.
class AuthController extends StateNotifier<AuthActionState> {
  AuthController(this._ref) : super(const AuthActionState());

  final Ref _ref;

  Future<AppUser?> signIn(String email, String password) => _run(
    () => _ref
        .read(authRepositoryProvider)
        .signInWithEmail(email: email, password: password),
  );

  Future<AppUser?> signUp(String name, String email, String password) => _run(
    () => _ref
        .read(authRepositoryProvider)
        .signUpWithEmail(name: name, email: email, password: password),
  );

  Future<AppUser?> signInWithGoogle() =>
      _run(() => _ref.read(authRepositoryProvider).signInWithGoogle());

  Future<void> signOut() async {
    state = state.copyWith(status: AuthActionStatus.loading);
    await _ref.read(authRepositoryProvider).signOut();
    state = const AuthActionState(status: AuthActionStatus.success);
    _ref.read(authTokenRevisionProvider.notifier).state++;
  }

  Future<AppUser?> _run(Future<AppUser> Function() action) async {
    state = state.copyWith(
      status: AuthActionStatus.loading,
      errorMessage: null,
    );
    try {
      final user = await action();
      state = state.copyWith(status: AuthActionStatus.success);
      _ref.read(authTokenRevisionProvider.notifier).state++;
      return user;
    } on ApiException catch (e) {
      state = AuthActionState(
        status: AuthActionStatus.error,
        errorMessage: e.message,
      );
      return null;
    } catch (e) {
      state = AuthActionState(
        status: AuthActionStatus.error,
        errorMessage: e.toString(),
      );
      return null;
    }
  }
}

final authControllerProvider =
    StateNotifierProvider<AuthController, AuthActionState>((ref) {
      return AuthController(ref);
    });
