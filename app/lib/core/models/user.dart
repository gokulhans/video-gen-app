import 'package:equatable/equatable.dart';

/// Mirrors the `user` table (better-auth core fields relevant to the client).
class AppUser extends Equatable {
  const AppUser({
    required this.id,
    required this.name,
    required this.email,
    this.image,
    this.tokens = 0,
  });

  final String id;
  final String name;
  final String email;
  final String? image;
  final int tokens;

  factory AppUser.fromJson(Map<String, dynamic> json) => AppUser(
        id: json['id'] as String,
        name: json['name'] as String? ?? '',
        email: json['email'] as String? ?? '',
        image: json['image'] as String?,
        tokens: (json['tokens'] as num?)?.toInt() ?? 0,
      );

  @override
  List<Object?> get props => [id, name, email, image, tokens];
}
