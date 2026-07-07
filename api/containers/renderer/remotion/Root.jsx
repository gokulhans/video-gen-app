import { Composition } from "remotion";
import { VideoComposition } from "./VideoComposition.jsx";
import { dimensionsFor } from "./types.js";

const FPS = 30;

/**
 * Single composition, driven entirely by `inputProps` — the render server
 * passes `{ composition: ProjectComposition, resolution }` at render time via
 * `renderMedia({ inputProps })`. `calculateMetadata` derives width/height
 * from `composition.ratio` + `resolution`, and duration from
 * `composition.durationSec` (falling back to the max scene `end` / word end
 * if longer).
 */
export const RemotionRoot = () => {
	return (
		<Composition
			id="MainComposition"
			component={VideoComposition}
			fps={FPS}
			durationInFrames={FPS * 30}
			width={1080}
			height={1920}
			defaultProps={{ composition: null, resolution: "720p" }}
			calculateMetadata={({ props }) => {
				const composition = props.composition;
				const resolution = props.resolution || "720p";
				const { width, height } = dimensionsFor(composition?.ratio || "9:16", resolution);

				const sceneEnds = (composition?.scenes || []).map((s) => s.end || 0);
				const wordEnds = (composition?.words || []).map((w) => w.end || 0);
				const maxEnd = Math.max(composition?.durationSec || 0, ...sceneEnds, ...wordEnds, 1);

				return {
					width,
					height,
					fps: FPS,
					durationInFrames: Math.ceil(maxEnd * FPS),
				};
			}}
		/>
	);
};
