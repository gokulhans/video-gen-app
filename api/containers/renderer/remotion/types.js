/**
 * Plain JSDoc duplicates of the shapes in `packages/shared/src/index.ts`
 * (`ProjectComposition`, `Scene`, `CaptionConfig`, `WordTimestamp`,
 * `BrandConfig`). The container app does NOT import workspace packages
 * (it's a standalone Docker image built independently of the pnpm
 * workspace), so these are duplicated here for editor/type-hint purposes
 * only — no runtime validation happens on this side, the render worker
 * (`apps/render`) already validated the payload with the real zod schemas
 * before it reaches `POST /render`.
 *
 * Keep in sync with packages/shared/src/index.ts by hand.
 */

/**
 * @typedef {Object} WordTimestamp
 * @property {string} word
 * @property {number} start - seconds
 * @property {number} end - seconds
 */

/**
 * @typedef {Object} SceneEffect
 * @property {"zoom_in"|"zoom_out"|"pan_left"|"pan_right"|"none"} type
 * @property {number} intensity - 0..1
 */

/**
 * @typedef {Object} Scene
 * @property {string} id
 * @property {number} order
 * @property {string} text
 * @property {number} start - seconds
 * @property {number} end - seconds
 * @property {string} imagePrompt
 * @property {string|null} imageUrl
 * @property {"pending"|"generating"|"ready"|"failed"} imageStatus
 * @property {SceneEffect} effect
 * @property {"none"|"fade"|"slide"|"wipe"} transition
 */

/**
 * @typedef {Object} CaptionConfig
 * @property {boolean} enabled
 * @property {"tiktok"|"clean"|"bold"|"karaoke"} preset
 * @property {"top"|"center"|"bottom"} position
 * @property {string} primaryColor
 * @property {string} highlightColor
 * @property {number} fontSize
 */

/**
 * @typedef {Object} BrandConfig
 * @property {string|null} logoUrl
 * @property {"top_left"|"top_right"|"bottom_left"|"bottom_right"|"none"} logoPosition
 * @property {string|null} primaryColor
 * @property {string|null} phone
 * @property {string|null} website
 * @property {boolean} watermark
 */

/**
 * @typedef {Object} ProjectComposition
 * @property {1} schemaVersion
 * @property {"9:16"|"1:1"|"16:9"} ratio
 * @property {number} durationSec
 * @property {string} language
 * @property {string} script
 * @property {string} voice
 * @property {string|null} voiceoverUrl
 * @property {string|null} musicUrl
 * @property {number} musicVolume - 0..1
 * @property {Scene[]} scenes
 * @property {WordTimestamp[]} words
 * @property {CaptionConfig} captions
 * @property {BrandConfig} brand
 */

/**
 * @typedef {Object} RenderRequest
 * @property {string} jobId
 * @property {ProjectComposition} composition
 * @property {"720p"|"1080p"} resolution
 * @property {string} outputKey
 */

export const DIMENSIONS_916 = { "720p": { width: 720, height: 1280 }, "1080p": { width: 1080, height: 1920 } };
export const DIMENSIONS_11 = { "720p": { width: 720, height: 720 }, "1080p": { width: 1080, height: 1080 } };
export const DIMENSIONS_169 = { "720p": { width: 1280, height: 720 }, "1080p": { width: 1920, height: 1080 } };

/**
 * @param {"9:16"|"1:1"|"16:9"} ratio
 * @param {"720p"|"1080p"} resolution
 */
export function dimensionsFor(ratio, resolution) {
	const table = ratio === "1:1" ? DIMENSIONS_11 : ratio === "16:9" ? DIMENSIONS_169 : DIMENSIONS_916;
	return table[resolution] ?? DIMENSIONS_916["720p"];
}
