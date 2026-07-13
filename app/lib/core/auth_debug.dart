import 'package:flutter/foundation.dart';

/// Writes authentication diagnostics without exposing credentials or tokens.
///
/// Auth logs are intentionally limited to debug builds because authentication
/// failures may contain user-provided or server-provided details.
void authDebug(String message) {
  if (kDebugMode) debugPrint('[Auth] $message');
}

/// Keeps enough of an email address to correlate repeated attempts while
/// avoiding a full address in logs.
String authEmailHint(String email) {
  final value = email.trim();
  final separator = value.lastIndexOf('@');
  if (separator <= 0 || separator == value.length - 1) return '<invalid-email>';
  return '${value.substring(0, 1)}***${value.substring(separator)}';
}
