import 'package:equatable/equatable.dart';

const _unset = Object();

/// Mirrors `WordTimestamp` in packages/shared/src/index.ts.
class WordTimestamp extends Equatable {
  const WordTimestamp({
    required this.word,
    required this.start,
    required this.end,
  });

  final String word;
  final double start; // seconds
  final double end;

  factory WordTimestamp.fromJson(Map<String, dynamic> json) => WordTimestamp(
    word: json['word'] as String,
    start: (json['start'] as num).toDouble(),
    end: (json['end'] as num).toDouble(),
  );

  Map<String, dynamic> toJson() => {'word': word, 'start': start, 'end': end};

  @override
  List<Object?> get props => [word, start, end];
}

enum SceneEffectType { zoomIn, zoomOut, panLeft, panRight, none }

extension SceneEffectTypeX on SceneEffectType {
  String get wireValue => switch (this) {
    SceneEffectType.zoomIn => 'zoom_in',
    SceneEffectType.zoomOut => 'zoom_out',
    SceneEffectType.panLeft => 'pan_left',
    SceneEffectType.panRight => 'pan_right',
    SceneEffectType.none => 'none',
  };

  static SceneEffectType fromWire(String? value) => switch (value) {
    'zoom_in' => SceneEffectType.zoomIn,
    'zoom_out' => SceneEffectType.zoomOut,
    'pan_left' => SceneEffectType.panLeft,
    'pan_right' => SceneEffectType.panRight,
    _ => SceneEffectType.none,
  };
}

/// Mirrors `SceneEffect`.
class SceneEffect extends Equatable {
  const SceneEffect({this.type = SceneEffectType.none, this.intensity = 0.5});

  final SceneEffectType type;
  final double intensity; // 0..1

  factory SceneEffect.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const SceneEffect();
    return SceneEffect(
      type: SceneEffectTypeX.fromWire(json['type'] as String?),
      intensity: (json['intensity'] as num?)?.toDouble() ?? 0.5,
    );
  }

  Map<String, dynamic> toJson() => {
    'type': type.wireValue,
    'intensity': intensity,
  };

  SceneEffect copyWith({SceneEffectType? type, double? intensity}) =>
      SceneEffect(
        type: type ?? this.type,
        intensity: intensity ?? this.intensity,
      );

  @override
  List<Object?> get props => [type, intensity];
}

enum ImageStatus { pending, generating, ready, failed }

extension ImageStatusX on ImageStatus {
  String get wireValue => name;
  static ImageStatus fromWire(String? value) => switch (value) {
    'generating' => ImageStatus.generating,
    'ready' => ImageStatus.ready,
    'failed' => ImageStatus.failed,
    _ => ImageStatus.pending,
  };
}

enum SceneTransition { none, fade, slide, wipe }

extension SceneTransitionX on SceneTransition {
  String get wireValue => name;
  static SceneTransition fromWire(String? value) => switch (value) {
    'fade' => SceneTransition.fade,
    'slide' => SceneTransition.slide,
    'wipe' => SceneTransition.wipe,
    _ => SceneTransition.none,
  };
}

/// Mirrors `Scene` in packages/shared/src/index.ts.
class Scene extends Equatable {
  const Scene({
    required this.id,
    required this.order,
    required this.text,
    required this.start,
    required this.end,
    this.imagePrompt = '',
    this.imageUrl,
    this.imageStatus = ImageStatus.pending,
    this.effect = const SceneEffect(),
    this.transition = SceneTransition.fade,
  });

  final String id;
  final int order;
  final String text;
  final double start;
  final double end;
  final String imagePrompt;
  final String? imageUrl;
  final ImageStatus imageStatus;
  final SceneEffect effect;
  final SceneTransition transition;

  factory Scene.fromJson(Map<String, dynamic> json) => Scene(
    id: json['id'] as String,
    order: (json['order'] as num).toInt(),
    text: json['text'] as String? ?? '',
    start: (json['start'] as num?)?.toDouble() ?? 0,
    end: (json['end'] as num?)?.toDouble() ?? 0,
    imagePrompt: json['imagePrompt'] as String? ?? '',
    imageUrl: json['imageUrl'] as String?,
    imageStatus: ImageStatusX.fromWire(json['imageStatus'] as String?),
    effect: SceneEffect.fromJson(json['effect'] as Map<String, dynamic>?),
    transition: SceneTransitionX.fromWire(json['transition'] as String?),
  );

  Map<String, dynamic> toJson() => {
    'id': id,
    'order': order,
    'text': text,
    'start': start,
    'end': end,
    'imagePrompt': imagePrompt,
    'imageUrl': imageUrl,
    'imageStatus': imageStatus.wireValue,
    'effect': effect.toJson(),
    'transition': transition.wireValue,
  };

  Scene copyWith({
    String? text,
    double? start,
    double? end,
    String? imagePrompt,
    Object? imageUrl = _unset,
    ImageStatus? imageStatus,
    SceneEffect? effect,
    SceneTransition? transition,
  }) => Scene(
    id: id,
    order: order,
    text: text ?? this.text,
    start: start ?? this.start,
    end: end ?? this.end,
    imagePrompt: imagePrompt ?? this.imagePrompt,
    imageUrl: identical(imageUrl, _unset) ? this.imageUrl : imageUrl as String?,
    imageStatus: imageStatus ?? this.imageStatus,
    effect: effect ?? this.effect,
    transition: transition ?? this.transition,
  );

  @override
  List<Object?> get props => [
    id,
    order,
    text,
    start,
    end,
    imagePrompt,
    imageUrl,
    imageStatus,
    effect,
    transition,
  ];
}

enum CaptionPreset { tiktok, clean, bold, karaoke }

extension CaptionPresetX on CaptionPreset {
  String get wireValue => name;
  static CaptionPreset fromWire(String? value) => switch (value) {
    'clean' => CaptionPreset.clean,
    'bold' => CaptionPreset.bold,
    'karaoke' => CaptionPreset.karaoke,
    _ => CaptionPreset.tiktok,
  };

  String get label => switch (this) {
    CaptionPreset.tiktok => 'TikTok',
    CaptionPreset.clean => 'Clean',
    CaptionPreset.bold => 'Bold',
    CaptionPreset.karaoke => 'Karaoke',
  };
}

enum CaptionPosition { top, center, bottom }

extension CaptionPositionX on CaptionPosition {
  String get wireValue => name;
  static CaptionPosition fromWire(String? value) => switch (value) {
    'top' => CaptionPosition.top,
    'center' => CaptionPosition.center,
    _ => CaptionPosition.bottom,
  };
}

/// Mirrors `CaptionConfig`.
class CaptionConfig extends Equatable {
  const CaptionConfig({
    this.enabled = true,
    this.preset = CaptionPreset.tiktok,
    this.position = CaptionPosition.bottom,
    this.primaryColor = '#FFFFFF',
    this.highlightColor = '#FFD700',
    this.fontSize = 48,
  });

  final bool enabled;
  final CaptionPreset preset;
  final CaptionPosition position;
  final String primaryColor;
  final String highlightColor;
  final double fontSize;

  factory CaptionConfig.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const CaptionConfig();
    return CaptionConfig(
      enabled: json['enabled'] as bool? ?? true,
      preset: CaptionPresetX.fromWire(json['preset'] as String?),
      position: CaptionPositionX.fromWire(json['position'] as String?),
      primaryColor: json['primaryColor'] as String? ?? '#FFFFFF',
      highlightColor: json['highlightColor'] as String? ?? '#FFD700',
      fontSize: (json['fontSize'] as num?)?.toDouble() ?? 48,
    );
  }

  Map<String, dynamic> toJson() => {
    'enabled': enabled,
    'preset': preset.wireValue,
    'position': position.wireValue,
    'primaryColor': primaryColor,
    'highlightColor': highlightColor,
    'fontSize': fontSize,
  };

  CaptionConfig copyWith({
    bool? enabled,
    CaptionPreset? preset,
    CaptionPosition? position,
    String? primaryColor,
    String? highlightColor,
    double? fontSize,
  }) => CaptionConfig(
    enabled: enabled ?? this.enabled,
    preset: preset ?? this.preset,
    position: position ?? this.position,
    primaryColor: primaryColor ?? this.primaryColor,
    highlightColor: highlightColor ?? this.highlightColor,
    fontSize: fontSize ?? this.fontSize,
  );

  @override
  List<Object?> get props => [
    enabled,
    preset,
    position,
    primaryColor,
    highlightColor,
    fontSize,
  ];
}

enum LogoPosition { topLeft, topRight, bottomLeft, bottomRight, none }

extension LogoPositionX on LogoPosition {
  String get wireValue => switch (this) {
    LogoPosition.topLeft => 'top_left',
    LogoPosition.topRight => 'top_right',
    LogoPosition.bottomLeft => 'bottom_left',
    LogoPosition.bottomRight => 'bottom_right',
    LogoPosition.none => 'none',
  };

  static LogoPosition fromWire(String? value) => switch (value) {
    'top_left' => LogoPosition.topLeft,
    'bottom_left' => LogoPosition.bottomLeft,
    'bottom_right' => LogoPosition.bottomRight,
    'none' => LogoPosition.none,
    _ => LogoPosition.topRight,
  };
}

/// Mirrors `BrandConfig` (the composition-embedded brand snapshot).
class BrandConfig extends Equatable {
  const BrandConfig({
    this.logoUrl,
    this.logoPosition = LogoPosition.topRight,
    this.primaryColor,
    this.phone,
    this.website,
    this.watermark = true,
  });

  final String? logoUrl;
  final LogoPosition logoPosition;
  final String? primaryColor;
  final String? phone;
  final String? website;
  final bool watermark;

  factory BrandConfig.fromJson(Map<String, dynamic>? json) {
    if (json == null) return const BrandConfig();
    return BrandConfig(
      logoUrl: json['logoUrl'] as String?,
      logoPosition: LogoPositionX.fromWire(json['logoPosition'] as String?),
      primaryColor: json['primaryColor'] as String?,
      phone: json['phone'] as String?,
      website: json['website'] as String?,
      watermark: json['watermark'] as bool? ?? true,
    );
  }

  Map<String, dynamic> toJson() => {
    'logoUrl': logoUrl,
    'logoPosition': logoPosition.wireValue,
    'primaryColor': primaryColor,
    'phone': phone,
    'website': website,
    'watermark': watermark,
  };

  BrandConfig copyWith({
    Object? logoUrl = _unset,
    LogoPosition? logoPosition,
    Object? primaryColor = _unset,
    Object? phone = _unset,
    Object? website = _unset,
    bool? watermark,
  }) => BrandConfig(
    logoUrl: identical(logoUrl, _unset) ? this.logoUrl : logoUrl as String?,
    logoPosition: logoPosition ?? this.logoPosition,
    primaryColor: identical(primaryColor, _unset)
        ? this.primaryColor
        : primaryColor as String?,
    phone: identical(phone, _unset) ? this.phone : phone as String?,
    website: identical(website, _unset) ? this.website : website as String?,
    watermark: watermark ?? this.watermark,
  );

  @override
  List<Object?> get props => [
    logoUrl,
    logoPosition,
    primaryColor,
    phone,
    website,
    watermark,
  ];
}

enum VideoRatio { r9x16, r1x1, r16x9 }

extension VideoRatioX on VideoRatio {
  String get wireValue => switch (this) {
    VideoRatio.r9x16 => '9:16',
    VideoRatio.r1x1 => '1:1',
    VideoRatio.r16x9 => '16:9',
  };

  static VideoRatio fromWire(String? value) => switch (value) {
    '1:1' => VideoRatio.r1x1,
    '16:9' => VideoRatio.r16x9,
    _ => VideoRatio.r9x16,
  };
}

/// Mirrors `ProjectComposition` — the editing document for a project.
class ProjectComposition extends Equatable {
  const ProjectComposition({
    this.schemaVersion = 1,
    this.ratio = VideoRatio.r9x16,
    required this.durationSec,
    this.language = 'en',
    required this.script,
    required this.voice,
    this.voiceoverUrl,
    this.musicUrl,
    this.musicVolume = 0.15,
    this.scenes = const [],
    this.words = const [],
    this.captions = const CaptionConfig(),
    this.brand = const BrandConfig(),
  });

  final int schemaVersion;
  final VideoRatio ratio;
  final double durationSec;
  final String language;
  final String script;
  final String voice;
  final String? voiceoverUrl;
  final String? musicUrl;
  final double musicVolume;
  final List<Scene> scenes;
  final List<WordTimestamp> words;
  final CaptionConfig captions;
  final BrandConfig brand;

  factory ProjectComposition.fromJson(Map<String, dynamic> json) =>
      ProjectComposition(
        schemaVersion: (json['schemaVersion'] as num?)?.toInt() ?? 1,
        ratio: VideoRatioX.fromWire(json['ratio'] as String?),
        durationSec: (json['durationSec'] as num?)?.toDouble() ?? 45,
        language: json['language'] as String? ?? 'en',
        script: json['script'] as String? ?? '',
        voice: json['voice'] as String? ?? 'alloy',
        voiceoverUrl: json['voiceoverUrl'] as String?,
        musicUrl: json['musicUrl'] as String?,
        musicVolume: (json['musicVolume'] as num?)?.toDouble() ?? 0.15,
        scenes: (json['scenes'] as List<dynamic>? ?? [])
            .map((e) => Scene.fromJson(e as Map<String, dynamic>))
            .toList(),
        words: (json['words'] as List<dynamic>? ?? [])
            .map((e) => WordTimestamp.fromJson(e as Map<String, dynamic>))
            .toList(),
        captions: CaptionConfig.fromJson(
          json['captions'] as Map<String, dynamic>?,
        ),
        brand: BrandConfig.fromJson(json['brand'] as Map<String, dynamic>?),
      );

  Map<String, dynamic> toJson() => {
    'schemaVersion': schemaVersion,
    'ratio': ratio.wireValue,
    'durationSec': durationSec,
    'language': language,
    'script': script,
    'voice': voice,
    'voiceoverUrl': voiceoverUrl,
    'musicUrl': musicUrl,
    'musicVolume': musicVolume,
    'scenes': scenes.map((s) => s.toJson()).toList(),
    'words': words.map((w) => w.toJson()).toList(),
    'captions': captions.toJson(),
    'brand': brand.toJson(),
  };

  ProjectComposition copyWith({
    VideoRatio? ratio,
    double? durationSec,
    String? language,
    String? script,
    String? voice,
    Object? voiceoverUrl = _unset,
    Object? musicUrl = _unset,
    double? musicVolume,
    List<Scene>? scenes,
    List<WordTimestamp>? words,
    CaptionConfig? captions,
    BrandConfig? brand,
  }) => ProjectComposition(
    schemaVersion: schemaVersion,
    ratio: ratio ?? this.ratio,
    durationSec: durationSec ?? this.durationSec,
    language: language ?? this.language,
    script: script ?? this.script,
    voice: voice ?? this.voice,
    voiceoverUrl: identical(voiceoverUrl, _unset)
        ? this.voiceoverUrl
        : voiceoverUrl as String?,
    musicUrl: identical(musicUrl, _unset) ? this.musicUrl : musicUrl as String?,
    musicVolume: musicVolume ?? this.musicVolume,
    scenes: scenes ?? this.scenes,
    words: words ?? this.words,
    captions: captions ?? this.captions,
    brand: brand ?? this.brand,
  );

  @override
  List<Object?> get props => [
    schemaVersion,
    ratio,
    durationSec,
    language,
    script,
    voice,
    voiceoverUrl,
    musicUrl,
    musicVolume,
    scenes,
    words,
    captions,
    brand,
  ];
}

/// Mirrors `GenerationParams` — the payload for `POST /projects/:id/generate`.
class GenerationParams extends Equatable {
  const GenerationParams({
    required this.templateId,
    this.brandId,
    required this.topic,
    this.details = '',
    this.language = 'en',
    this.durationSec = 45,
    this.voice = 'alloy',
  });

  final String templateId;
  final String? brandId;
  final String topic;
  final String details;
  final String language;
  final int durationSec;
  final String voice;

  Map<String, dynamic> toJson() => {
    'templateId': templateId,
    'brandId': brandId,
    'topic': topic,
    'details': details,
    'language': language,
    'durationSec': durationSec,
    'voice': voice,
  };

  @override
  List<Object?> get props => [
    templateId,
    brandId,
    topic,
    details,
    language,
    durationSec,
    voice,
  ];
}

enum RenderStatus { queued, starting, rendering, uploading, completed, failed }

extension RenderStatusX on RenderStatus {
  String get wireValue => name;
  static RenderStatus fromWire(String? value) => switch (value) {
    'starting' => RenderStatus.starting,
    'rendering' => RenderStatus.rendering,
    'uploading' => RenderStatus.uploading,
    'completed' => RenderStatus.completed,
    'failed' => RenderStatus.failed,
    _ => RenderStatus.queued,
  };
}

/// Mirrors `RenderProgressMessage` — pushed over the RenderJobDO WebSocket
/// and returned by `GET /render-jobs/:id`.
class RenderProgressMessage extends Equatable {
  const RenderProgressMessage({
    required this.jobId,
    required this.status,
    required this.progress,
    this.videoUrl,
    this.error,
  });

  final String jobId;
  final RenderStatus status;
  final double progress; // 0..100
  final String? videoUrl;
  final String? error;

  factory RenderProgressMessage.fromJson(Map<String, dynamic> json) =>
      RenderProgressMessage(
        jobId: json['jobId'] as String,
        status: RenderStatusX.fromWire(json['status'] as String?),
        progress: (json['progress'] as num?)?.toDouble() ?? 0,
        videoUrl: json['videoUrl'] as String?,
        error: json['error'] as String?,
      );

  @override
  List<Object?> get props => [jobId, status, progress, videoUrl, error];
}

/// Generation pipeline stages, per Cloudflare_Rewrite_Plan.md §5.
enum GenerationStage { script, voice, captions, scenes, images, done, failed }

extension GenerationStageX on GenerationStage {
  static GenerationStage fromWire(String? value) => switch (value) {
    'generate-script' || 'script' => GenerationStage.script,
    'generate-voiceover' || 'voice' => GenerationStage.voice,
    'generate-timestamps' || 'captions' => GenerationStage.captions,
    'build-scenes' || 'scenes' => GenerationStage.scenes,
    'images' => GenerationStage.images,
    'complete' || 'done' => GenerationStage.done,
    'failed' => GenerationStage.failed,
    _ => GenerationStage.script,
  };

  String get label => switch (this) {
    GenerationStage.script => 'Writing script',
    GenerationStage.voice => 'Generating voiceover',
    GenerationStage.captions => 'Aligning captions',
    GenerationStage.scenes => 'Building scenes',
    GenerationStage.images => 'Generating images',
    GenerationStage.done => 'Done',
    GenerationStage.failed => 'Failed',
  };
}
