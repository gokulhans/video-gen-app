import 'package:equatable/equatable.dart';

import 'composition.dart';

/// Mirrors the `brands` table — a saved brand kit a user can attach to
/// projects (logo, colors, contact info, watermark preference).
class Brand extends Equatable {
  const Brand({
    required this.id,
    required this.name,
    this.logoUrl,
    this.primaryColor,
    this.secondaryColor,
    this.font,
    this.phone,
    this.website,
    this.watermark = true,
    this.logoPosition = LogoPosition.topRight,
  });

  final String id;
  final String name;
  final String? logoUrl;
  final String? primaryColor;
  final String? secondaryColor;
  final String? font;
  final String? phone;
  final String? website;
  final bool watermark;
  final LogoPosition logoPosition;

  factory Brand.fromJson(Map<String, dynamic> json) => Brand(
        id: json['id'] as String,
        name: json['name'] as String? ?? 'My brand',
        logoUrl: json['logoUrl'] as String?,
        primaryColor: json['primaryColor'] as String?,
        secondaryColor: json['secondaryColor'] as String?,
        font: json['font'] as String?,
        phone: json['phone'] as String?,
        website: json['website'] as String?,
        watermark: json['watermark'] as bool? ?? true,
        logoPosition: LogoPositionX.fromWire(json['logoPosition'] as String?),
      );

  Map<String, dynamic> toJson() => {
        'name': name,
        'logoUrl': logoUrl,
        'primaryColor': primaryColor,
        'secondaryColor': secondaryColor,
        'font': font,
        'phone': phone,
        'website': website,
        'watermark': watermark,
        'logoPosition': logoPosition.wireValue,
      };

  BrandConfig toBrandConfig() => BrandConfig(
        logoUrl: logoUrl,
        logoPosition: logoPosition,
        primaryColor: primaryColor,
        phone: phone,
        website: website,
        watermark: watermark,
      );

  @override
  List<Object?> get props => [
        id,
        name,
        logoUrl,
        primaryColor,
        secondaryColor,
        font,
        phone,
        website,
        watermark,
        logoPosition,
      ];
}
