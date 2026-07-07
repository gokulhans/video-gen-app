import { useCurrentFrame, useVideoConfig, interpolate } from "remotion";

const POSITION_TOP_PERCENT = { top: 12, center: 50, bottom: 82 };

const PRESET_BASE_STYLE = {
	tiktok: { padding: "12px 20px", borderRadius: 12, textTransform: "uppercase", letterSpacing: 1, fontWeight: 900 },
	clean: { padding: "8px 16px", borderRadius: 8, letterSpacing: 0.5, fontWeight: 500, backdropFilter: "blur(4px)" },
	bold: { padding: "10px 20px", borderRadius: 6, letterSpacing: 0.5, fontWeight: 800 },
	karaoke: { padding: "10px 18px", borderRadius: 10, letterSpacing: 0.5, fontWeight: 700 },
};

/**
 * @param {{
 *   words: Array<{ start: number, end: number, text: string, words: import('./types.js').WordTimestamp[] }>,
 *   captionConfig: import('./types.js').CaptionConfig,
 *   sceneStart: number,
 *   sceneEnd: number,
 * }} props
 */
export const TikTokCaption = ({ words, captionConfig, sceneStart = 0 }) => {
	const frame = useCurrentFrame();
	const { fps } = useVideoConfig();

	if (!captionConfig?.enabled || !Array.isArray(words) || words.length === 0) return null;

	const globalTimeSec = sceneStart + frame / fps;
	const active = words.find((group) => globalTimeSec >= group.start && globalTimeSec <= group.end);
	if (!active) return null;

	const animMs = 0.25; // seconds
	const scale = interpolate(globalTimeSec, [active.start, active.start + animMs], [0.85, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});
	const opacity = interpolate(globalTimeSec, [active.start, active.start + 0.12], [0, 1], {
		extrapolateLeft: "clamp",
		extrapolateRight: "clamp",
	});

	const preset = PRESET_BASE_STYLE[captionConfig.preset] || PRESET_BASE_STYLE.tiktok;
	const primaryColor = captionConfig.primaryColor || "#FFFFFF";
	const highlightColor = captionConfig.highlightColor || "#FFD700";
	const fontSize = captionConfig.fontSize || 48;
	const topPercent = POSITION_TOP_PERCENT[captionConfig.position] ?? POSITION_TOP_PERCENT.bottom;

	return (
		<div
			style={{
				position: "absolute",
				left: "50%",
				top: `${topPercent}%`,
				transform: `translate(-50%, -50%) scale(${scale})`,
				fontSize,
				textAlign: "center",
				maxWidth: "90%",
				wordWrap: "break-word",
				opacity,
				zIndex: 10,
				lineHeight: 1.3,
				fontFamily: "Inter, system-ui, sans-serif",
				background: "rgba(0,0,0,0.55)",
				color: primaryColor,
				boxShadow: "0 8px 25px rgba(0,0,0,0.3)",
				...preset,
			}}
		>
			{Array.isArray(active.words) && active.words.length > 0
				? active.words.map((word, i) => {
						const isCurrent = globalTimeSec >= word.start && globalTimeSec <= word.end;
						return (
							<span
								key={i}
								style={{
									display: "inline-block",
									marginRight: "0.3em",
									color: isCurrent ? highlightColor : primaryColor,
									transform: isCurrent ? "scale(1.08)" : "scale(1)",
									opacity: isCurrent ? 1 : 0.85,
								}}
							>
								{word.word}
							</span>
						);
					})
				: active.text}
		</div>
	);
};
