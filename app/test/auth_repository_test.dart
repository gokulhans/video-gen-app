import 'package:ai_video_maker/core/auth_repository.dart';
import 'package:flutter_test/flutter_test.dart';

void main() {
  test('Google native sign-in uses Better Auth ID-token contract', () {
    expect(googleIdTokenSignInBody('google-token'), {
      'provider': 'google',
      'idToken': {'token': 'google-token'},
    });
  });
}
