import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";
import { Scene } from "./Scene.jsx";

const TRANSITION_DURATION_SEC = 0.5;

/**
 * `scene.transition` describes the transition OUT of `scene` and into
 * `nextScene` (matches packages/shared's `Scene.transition`: "none" | "fade"
 * | "slide" | "wipe").
 */
function transitionStyle(frame, transitionFrames, type, isOutgoing) {
	switch (type) {
		case "fade":
			return {
				opacity: isOutgoing
					? interpolate(frame, [0, transitionFrames], [1, 0], { extrapolateRight: "clamp" })
					: interpolate(frame, [0, transitionFrames], [0, 1], { extrapolateRight: "clamp" }),
			};

		case "slide":
			return {
				transform: isOutgoing
					? `translateX(${interpolate(frame, [0, transitionFrames], [0, -100], { extrapolateRight: "clamp" })}%)`
					: `translateX(${interpolate(frame, [0, transitionFrames], [100, 0], { extrapolateRight: "clamp" })}%)`,
			};

		case "wipe": {
			const progress = interpolate(frame, [0, transitionFrames], [0, 100], { extrapolateRight: "clamp" });
			return isOutgoing
				? { clipPath: `inset(0 0 0 ${progress}%)` }
				: { clipPath: `inset(0 ${100 - progress}% 0 0)` };
		}

		case "none":
		default:
			return {};
	}
}

/**
 * @param {{
 *   scene: import('./types.js').Scene,
 *   nextScene: import('./types.js').Scene | null,
 *   captions: any[],
 *   captionConfig: import('./types.js').CaptionConfig,
 *   sceneDuration: number,
 *   fps: number,
 * }} props
 */
export const TransitionScene = ({ scene, nextScene, captions, captionConfig, sceneDuration, fps }) => {
	const frame = useCurrentFrame();
	const totalSceneFrames = Math.ceil(sceneDuration * fps);
	const transitionFrames = Math.ceil(TRANSITION_DURATION_SEC * fps);
	const preTransitionFrames = Math.max(totalSceneFrames - transitionFrames, 0);

	const inTransition = frame >= preTransitionFrames && nextScene && scene.transition !== "none";

	if (inTransition) {
		const transitionFrame = frame - preTransitionFrames;
		const outgoingStyle = transitionStyle(transitionFrame, transitionFrames, scene.transition, true);
		const incomingStyle = transitionStyle(transitionFrame, transitionFrames, scene.transition, false);

		return (
			<AbsoluteFill>
				<AbsoluteFill style={outgoingStyle}>
					<Scene scene={scene} captions={captions} captionConfig={captionConfig} isInTransition />
				</AbsoluteFill>
				<AbsoluteFill style={incomingStyle}>
					<Scene scene={nextScene} captions={[]} captionConfig={captionConfig} isInTransition isIncoming />
				</AbsoluteFill>
			</AbsoluteFill>
		);
	}

	return <Scene scene={scene} captions={captions} captionConfig={captionConfig} />;
};
