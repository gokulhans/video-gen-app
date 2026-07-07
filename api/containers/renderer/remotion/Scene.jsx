import { AbsoluteFill, Img, useCurrentFrame, useVideoConfig, interpolate } from "remotion";
import { TikTokCaption } from "./TikTokCaption.jsx";

/**
 * `scene.effect` matches packages/shared's `SceneEffect`:
 * { type: "zoom_in" | "zoom_out" | "pan_left" | "pan_right" | "none", intensity: 0..1 }
 */
function applyEffect(frame, effectDurationFrames, effect) {
	if (!effect || effect.type === "none") return {};
	const intensity = effect.intensity ?? 0.5;
	const progress = Math.min(frame / Math.max(effectDurationFrames, 1), 1);
	const eased = progress * progress * (3 - 2 * progress); // smoothstep

	switch (effect.type) {
		case "zoom_in": {
			const scale = 1 + eased * (0.15 + intensity * 0.35); // up to ~1.5x
			return { transform: `scale(${scale})`, transformOrigin: "center center" };
		}
		case "zoom_out": {
			const startScale = 1 + (0.15 + intensity * 0.35);
			const scale = startScale - eased * (startScale - 1);
			return { transform: `scale(${scale})`, transformOrigin: "center center" };
		}
		case "pan_left": {
			const translate = interpolate(eased, [0, 1], [0, -(4 + intensity * 8)]);
			return { transform: `scale(1.12) translateX(${translate}%)`, transformOrigin: "center center" };
		}
		case "pan_right": {
			const translate = interpolate(eased, [0, 1], [0, 4 + intensity * 8]);
			return { transform: `scale(1.12) translateX(${translate}%)`, transformOrigin: "center center" };
		}
		default:
			return {};
	}
}

/**
 * @param {{
 *   scene: import('./types.js').Scene,
 *   captions: any[],
 *   captionConfig: import('./types.js').CaptionConfig,
 *   isInTransition?: boolean,
 *   isIncoming?: boolean,
 * }} props
 */
export const Scene = ({ scene, captions, captionConfig, isInTransition = false, isIncoming = false }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	const sceneDurationFrames = Math.max(Math.ceil(((scene.end ?? 0) - (scene.start ?? 0)) * fps), 1);
	// Disable effects on the incoming scene during a transition to avoid a
	// visible "pre-zoom" jump the instant it appears.
	const shouldApplyEffect = !isInTransition || !isIncoming;
	const style = shouldApplyEffect ? applyEffect(frame, Math.ceil(sceneDurationFrames * 0.85), scene.effect) : {};

	return (
		<AbsoluteFill>
			{scene.imageUrl ? (
				<Img
					src={scene.imageUrl}
					style={{ width: "100%", height: "100%", objectFit: "cover", ...style }}
				/>
			) : (
				<div
					style={{
						width: "100%",
						height: "100%",
						backgroundColor: "#1a1a1a",
						display: "flex",
						alignItems: "center",
						justifyContent: "center",
						color: "#666",
						fontSize: "2rem",
						...style,
					}}
				>
					Scene {scene.order + 1}
				</div>
			)}

			<TikTokCaption words={captions} captionConfig={captionConfig} sceneStart={scene.start} sceneEnd={scene.end} />
		</AbsoluteFill>
	);
};
