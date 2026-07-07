import { AbsoluteFill, Audio, Img, Sequence, useVideoConfig } from "remotion";
import { TransitionScene } from "./TransitionScene.jsx";

/**
 * Groups word-level timestamps (seconds) into TikTok-style caption chunks.
 * @param {import('./types.js').WordTimestamp[]} words
 * @param {number} maxGapSec
 * @param {number} maxWordsPerGroup
 */
function groupCaptions(words, maxGapSec = 0.5, maxWordsPerGroup = 4) {
	if (!Array.isArray(words) || words.length === 0) return [];

	const groups = [];
	let current = [];

	for (const word of words) {
		if (typeof word?.start !== "number") continue;

		if (current.length === 0) {
			current = [word];
			continue;
		}

		const prev = current[current.length - 1];
		if (word.start - prev.end > maxGapSec || current.length >= maxWordsPerGroup) {
			groups.push(toGroup(current));
			current = [word];
		} else {
			current.push(word);
		}
	}
	if (current.length > 0) groups.push(toGroup(current));

	return groups;
}

function toGroup(words) {
	return {
		start: words[0].start,
		end: words[words.length - 1].end,
		words,
		text: words.map((w) => w.word).join(" "),
	};
}

const LOGO_POSITION_STYLE = {
	top_left: { top: 32, left: 32 },
	top_right: { top: 32, right: 32 },
	bottom_left: { bottom: 32, left: 32 },
	bottom_right: { bottom: 32, right: 32 },
};

/**
 * @param {{ composition: import('./types.js').ProjectComposition }} props
 */
export const VideoComposition = ({ composition }) => {
	const { fps } = useVideoConfig();

	if (!composition) {
		return (
			<AbsoluteFill style={{ backgroundColor: "black" }} />
		);
	}

	const scenes = [...(composition.scenes || [])].sort((a, b) => a.order - b.order);
	const captions = composition.captions?.enabled ? groupCaptions(composition.words || []) : [];

	return (
		<AbsoluteFill style={{ backgroundColor: "black" }}>
			{scenes.map((scene, index) => {
				const nextScene = index < scenes.length - 1 ? scenes[index + 1] : null;
				const sceneDurationSec = Math.max(scene.end - scene.start, 0.01);
				const from = Math.round(scene.start * fps);
				const durationInFrames = Math.max(Math.round(sceneDurationSec * fps), 1);

				return (
					<Sequence key={scene.id} from={from} durationInFrames={durationInFrames}>
						<TransitionScene
							scene={scene}
							nextScene={nextScene}
							captions={captions}
							captionConfig={composition.captions}
							sceneDuration={sceneDurationSec}
							fps={fps}
						/>
					</Sequence>
				);
			})}

			{composition.brand?.logoUrl && composition.brand.logoPosition !== "none" && (
				<Img
					src={composition.brand.logoUrl}
					style={{
						position: "absolute",
						width: 120,
						height: 120,
						objectFit: "contain",
						zIndex: 20,
						...(LOGO_POSITION_STYLE[composition.brand.logoPosition] || LOGO_POSITION_STYLE.top_right),
					}}
				/>
			)}

			{composition.voiceoverUrl && <Audio src={composition.voiceoverUrl} />}
			{composition.musicUrl && <Audio src={composition.musicUrl} volume={composition.musicVolume ?? 0.15} />}
		</AbsoluteFill>
	);
};
