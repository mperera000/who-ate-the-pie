// Character looks for "Who Ate the Pie?": Goldilocks and the Three Bears.
//
// Style (v2): whimsical 3D characters that look sculpted from thousands of glowing,
// translucent glass-fiber brushstrokes, with iridescent rainbow sheen and neon bloom,
// simple wide-eyed cartoon faces, set against deep ultramarine blue.
//
// Prompts are still written for image-to-3D: one character, full body, front view,
// relaxed A-pose, empty hands, plain solid background.

export interface CharacterArt {
  id: "goldilocks" | "papa" | "mama" | "baby";
  name: string;
  color: string;
  look: string;
}

export const ART_STYLE = [
  "Whimsical, unique 3D character that looks sculpted from thousands of translucent glowing glass-fiber strands and scratchy painterly brushstrokes,",
  "iridescent holographic rainbow sheen with chromatic dispersion, emissive neon glow with soft bloom, vivid saturated colors,",
  "hand-drawn texture wrapped over soft rounded 3D forms.",
  "Exaggerated whimsical proportions: a huge oversized head, enormous round white eyes with tiny black pupils, a very expressive face,",
  "quirky storybook body shapes, short stubby limbs.",
  "Full body, the entire figure visible from the top of the head to the feet with empty space around it,",
  "standing upright in a relaxed A-pose with arms held slightly away from the body and open empty hands, feet slightly apart,",
  "facing straight toward the camera, front view, centered.",
  "Plain solid deep ultramarine blue background with nothing else in it, single character only, no text, no logo.",
].join(" ");

export const NEGATIVE =
  "multiple characters, cropped, cut off feet, cut off head, side view, back view, three-quarter view, " +
  "holding objects, props in hands, scenery, floor, furniture, gradient background, text, watermark, logo, " +
  "extra limbs, extra fingers, realistic photograph, plain plastic, flat 2D illustration";

export const CHARACTER_ART: CharacterArt[] = [
  {
    id: "goldilocks",
    name: "Detective Goldilocks",
    color: "#ffb020",
    look:
      "Detective Goldilocks, a young girl detective with a tiny body, a giant round head and an enormous cloud of curly hair made of glowing molten-gold and orange glass strands, " +
      "even bigger than her head. One eyebrow raised high and eyes narrowed in a sharp, suspicious, know-it-all squint, a small determined pout. " +
      "She is dressed like a classic Victorian detective: a deerstalker hat with ear flaps tied on top, woven from glowing caramel-and-violet houndstooth tweed fibers, " +
      "a long Inverness cape coat with a short shoulder cape in the same glowing tweed, glowing brass buttons, a magnifying glass hanging from her belt at the hip, " +
      "little lace-up boots.",
  },
  {
    id: "papa",
    name: "Papa Bear",
    color: "#ff6a3d",
    look:
      "Papa Bear, a huge pear-shaped bear standing upright on two short stubby legs, an enormous round belly, tiny round ears on a giant head, " +
      "with fur made of glowing amber and copper glass strands. Bushy eyebrows pushed up in worry, huge nervous eyes, a sweaty guilty look and a wobbly little mouth. " +
      "He wears a plaid flannel shirt woven from glowing red and magenta neon fibers stretched over his belly, suspenders, dark blue trousers and chunky boots.",
  },
  {
    id: "mama",
    name: "Mama Bear",
    color: "#ff9bd2",
    look:
      "Mama Bear, a tall, egg-shaped bear standing upright on two short legs, a long elegant neck and a big round head, with fur made of glowing honey-gold glass strands. " +
      "Half-closed, knowing eyes with long glowing eyelashes and a sly, secretive little smirk, as if she knows exactly who did it. " +
      "She wears a cardigan woven from pearly pink and lavender iridescent fibers over a pumpkin-orange dress, an apron with a small glowing pumpkin on it, " +
      "and a string of shimmering pearls.",
  },
  {
    id: "baby",
    name: "Baby Bear",
    color: "#3ee6c4",
    look:
      "Baby Bear, a tiny bear cub with a giant head bigger than his whole round little body, standing upright on two tiny legs, " +
      "with fur made of glowing peach and caramel glass strands and big round ears. Gigantic shiny eyes, chubby glowing cheeks and a wide nervous too-innocent grin. " +
      "He wears a striped shirt woven from glowing teal and yellow neon fibers, red overalls and a little knitted green scarf.",
  },
];

export const promptFor = (c: CharacterArt) => `${c.look} ${ART_STYLE}`;

// The film's set: a cutaway of the Three Bears' log cabin, rooms laid out 2x2 so the
// stage can place characters in each quadrant.
export const CABIN_PROMPT = [
  "Cutaway dollhouse cross-section of a cozy log cabin in a night forest, seen straight from the front like a theatre set,",
  "four rooms in a two by two grid separated by thick log walls and floors:",
  "top-left a kitchen with a pumpkin pie on a wooden counter; top-right a dining room with a table and three porridge bowls, big, medium and small;",
  "bottom-left a parlour with a stone fireplace and three armchairs, big, medium and small; bottom-right a bedroom with three beds, big, medium and small.",
  "Empty floor space in the lower half of every room. No characters, no people, no animals, no text.",
  "Art style exactly matching whimsical 3D characters made of thousands of translucent glowing glass-fiber strands and scratchy painterly brushstrokes:",
  "every log, chair, bed, bowl and the pie is sculpted from glowing translucent glass threads with iridescent holographic rainbow sheen and soft neon bloom,",
  "deep ultramarine and violet blue palette with warm molten-amber firelight glowing through the glass, dark blue night forest outside, stylized, dreamy, not photorealistic.",
].join(" ");
