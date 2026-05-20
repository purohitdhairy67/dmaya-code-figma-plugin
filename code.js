figma.showUI(__html__, { width: 430, height: 620, themeColors: true });

const DEFAULT_FONT = { family: "Inter", style: "Regular" };
const PLUGIN_VERSION = "0.2.2";
const PLUGIN_BUILD = "static-decor-v4";
const SUPPORTED_PAYLOAD_VERSION = "html-to-figma-plugin-payload-v1";
const SUPPORTED_BACKEND_IMPORT_PLAN_VERSION = "figma-import-plan-v1";
const MAX_IMAGE_DIMENSION = 4096;
const MULTI_LINE_WIDTH_FACTOR = 1.08;
const MULTI_LINE_MIN_PADDING = 8;
const REMOTE_IMAGE_MIME_TYPES = ["image/png", "image/jpeg", "image/jpg", "image/gif"];

let defaultFontLoaded = false;

async function ensureDefaultFont() {
  if (defaultFontLoaded) return;
  await figma.loadFontAsync(DEFAULT_FONT);
  defaultFontLoaded = true;
}

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function safeSize(value) {
  return clamp(value, 1, 100000);
}

function roundPixel(value) {
  return Math.round(value * 100) / 100;
}

function fontFamiliesFromCss(value) {
  if (!value || typeof value !== "string") return [DEFAULT_FONT.family];
  const genericFamilies = new Set([
    "sans-serif",
    "serif",
    "monospace",
    "system-ui",
    "ui-sans-serif",
    "ui-serif",
    "ui-monospace",
    "-apple-system",
    "blinkmacsystemfont",
    "apple color emoji",
    "segoe ui emoji",
    "segoe ui symbol",
    "noto color emoji",
    "cursive",
    "fantasy",
  ]);
  const families = value
    .split(",")
    .map((family) => family.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);
  const concreteFamilies = families.filter((family) => !genericFamilies.has(family.toLowerCase()));
  return concreteFamilies.length > 0 ? concreteFamilies : [DEFAULT_FONT.family];
}

function fontFamilyFromCss(value) {
  return fontFamiliesFromCss(value)[0] || DEFAULT_FONT.family;
}

function inferredWeightForFamily(family, fallbackWeight) {
  const source = String(family || "").toLowerCase().replace(/[_-]+/g, " ");
  let weight = Number(fallbackWeight) || 400;
  if (/\b(?:black|heavy)\b/.test(source)) weight = 900;
  else if (/\b(?:extra|ultra)\s*bold\b/.test(source)) weight = 800;
  else if (/\b(?:semi|demi)\s*bold\b/.test(source) || /\bpn\s*sb\b/.test(source)) weight = 600;
  else if (/\bbold\b/.test(source)) weight = 700;
  else if (/\bmedium\b/.test(source)) weight = 500;
  else if (/\b(?:extra|ultra)\s*light\b/.test(source)) weight = 200;
  else if (/\blight\b/.test(source)) weight = 300;
  else if (/\bthin\b/.test(source)) weight = 100;
  return weight;
}

function inferredStyleForFamily(family, fallbackStyle) {
  const source = String(family || "").toLowerCase();
  const fallback = String(fallbackStyle || "").toLowerCase();
  if (fallback.includes("italic") || fallback.includes("oblique")) return "italic";
  if (source.includes("italic") || source.includes("oblique")) return "italic";
  return "normal";
}

function interStyleForWeight(weight, fontStyle) {
  const numericWeight = Number(weight) || 400;
  const italic = String(fontStyle || "").toLowerCase().includes("italic");
  let style = "Regular";
  if (numericWeight < 350) style = "Light";
  else if (numericWeight < 450) style = "Regular";
  else if (numericWeight < 550) style = "Medium";
  else if (numericWeight < 650) style = "Semi Bold";
  else if (numericWeight < 750) style = "Bold";
  else if (numericWeight < 850) style = "Extra Bold";
  else style = "Black";
  return italic ? `${style} Italic` : style;
}

function pushUniqueFontCandidate(candidates, seen, family, style) {
  if (!family || !style) return;
  const key = String(family) + "\n" + String(style);
  if (seen[key]) return;
  seen[key] = true;
  candidates.push({ family: family, style: style });
}

function fontStyleNameVariants(cssStyle) {
  const source = String(cssStyle || DEFAULT_FONT.style);
  const styles = [];
  const seen = {};
  const push = function (style) {
    if (!style || seen[style]) return;
    seen[style] = true;
    styles.push(style);
  };
  push(source);
  push(source.replace(/\s+/g, ""));
  if (source.endsWith(" Italic")) {
    const base = source.replace(/\s+Italic$/, "");
    push(`${base.replace(/\s+/g, "")} Italic`);
    push(`${base.replace(/\s+/g, "")}Italic`);
    if (base === "Regular") push("Italic");
  }
  if (source === "Regular Italic") push("Italic");
  return styles;
}

function pushFontStyleCandidates(candidates, seen, family, style) {
  for (const variant of fontStyleNameVariants(style)) {
    pushUniqueFontCandidate(candidates, seen, family, variant);
  }
}

function pushHandwritingFontCandidates(candidates, seen, weight, fontStyle) {
  const italic = String(fontStyle || "").toLowerCase().includes("italic");
  const style = interStyleForWeight(weight, italic ? "italic" : "normal");
  const handwritingFamilies = [
    "FriendlyFont",
    "Bradley Hand",
    "Noteworthy",
    "Marker Felt",
    "Chalkboard SE",
    "Comic Sans MS",
    "Segoe Print",
  ];
  for (const family of handwritingFamilies) {
    pushFontStyleCandidates(candidates, seen, family, style);
    pushUniqueFontCandidate(candidates, seen, family, italic ? "Italic" : "Regular");
    pushUniqueFontCandidate(candidates, seen, family, "Regular");
    pushUniqueFontCandidate(candidates, seen, family, "Light");
    pushUniqueFontCandidate(candidates, seen, family, "Bold");
  }
}

async function loadBestFont(textStyle) {
  await ensureDefaultFont();
  const cssFamilyValue = textStyle && textStyle.fontFamily;
  const cssFamilies = fontFamiliesFromCss(cssFamilyValue);
  const inferredWeight = inferredWeightForFamily(cssFamilyValue, textStyle && textStyle.fontWeight);
  const inferredStyle = inferredStyleForFamily(cssFamilyValue, textStyle && textStyle.fontStyle);
  const cssStyle = interStyleForWeight(inferredWeight, inferredStyle);
  const handwrittenStack = /friendlyfont|cursive|script|handwriting/i.test(String(cssFamilyValue || ""));
  const candidates = [];
  const seen = {};

  for (let index = 0; index < cssFamilies.length; index += 1) {
    const family = cssFamilies[index];
    const familyWeight = inferredWeightForFamily(family, inferredWeight);
    const familyStyle = inferredStyleForFamily(family, inferredStyle);
    pushFontStyleCandidates(candidates, seen, family, interStyleForWeight(familyWeight, familyStyle));
    if (familyStyle === "italic") {
      pushUniqueFontCandidate(candidates, seen, family, "Italic");
      pushUniqueFontCandidate(candidates, seen, family, "Regular Italic");
    }
    pushUniqueFontCandidate(candidates, seen, family, "Regular");
    if (index === 0 && handwrittenStack) {
      pushHandwritingFontCandidates(candidates, seen, familyWeight, familyStyle);
    }
  }

  pushFontStyleCandidates(candidates, seen, DEFAULT_FONT.family, cssStyle);
  if (inferredStyle === "italic") pushUniqueFontCandidate(candidates, seen, DEFAULT_FONT.family, "Italic");
  pushUniqueFontCandidate(candidates, seen, DEFAULT_FONT.family, DEFAULT_FONT.style);

  for (const candidate of candidates) {
    try {
      await figma.loadFontAsync(candidate);
      return candidate;
    } catch (error) {
      // Try the next closest installed font/style.
    }
  }

  await ensureDefaultFont();
  return DEFAULT_FONT;
}

function iconLigatureReplacement(value) {
  const ligatures = {
    arrow_forward: "→",
    arrow_back: "←",
    arrow_upward: "↑",
    arrow_downward: "↓",
    north_east: "↗",
    open_in_new: "↗",
    location_on: "⌖",
    schedule: "◷",
    mail: "✉",
    close: "×",
    menu: "☰",
    add: "+",
    remove: "−",
    check: "✓",
  };
  return ligatures[value] || value;
}

function privateUseIconReplacement(value, fontFamily) {
  const characters = String(value || "");
  const trimmed = characters.trim();
  const family = String(fontFamily || "").toLowerCase();
  if (!trimmed) return characters;

  if (family.indexOf("linearicons") !== -1) {
    const linearicons = {
      "\ue613": "⚙",
      "\ue627": "◉",
      "\ue673": "⌘",
      "\ue681": "⌫",
      "\ue696": "▾",
      "\ue69f": "▱",
      "\ue6b3": "☷",
      "\ue6b4": "▧",
      "\ue6b5": "▤",
      "\ue6b8": "▣",
      "\ue722": "◍",
      "\ue723": "◷",
      "\ue726": "⌘",
      "\ue74f": "−",
      "\ue750": "◻",
      "\ue755": "◇",
      "\ue757": "%",
      "\ue759": "◌",
      "\ue789": "◷",
      "\ue7da": "▴",
      "\ue7f8": "◷",
      "\ue884": "→",
      "\ue8da": "↻",
      "\ue8ea": "◎",
      "\ue915": "∞",
      "\ue93b": "‹",
      "\ue93c": "›",
      "\ue944": "!",
      "\ue994": "→",
    };
    return linearicons[trimmed] || (isPrivateUseText(trimmed) ? "•" : characters);
  }

  if (family.indexOf("ionicons") !== -1 && isPrivateUseText(trimmed)) {
    const ionicons = {
      "\uf104": "‹",
      "\uf122": "→",
      "\uf124": "→",
      "\uf128": "→",
      "\uf12a": "→",
      "\uf2d7": "⌄",
    };
    return ionicons[trimmed] || "•";
  }

  return characters;
}

function isPrivateUseText(value) {
  const characters = String(value || "");
  if (!characters) return false;
  for (let index = 0; index < characters.length; index += 1) {
    const code = characters.charCodeAt(index);
    if (/\s/.test(characters.charAt(index))) continue;
    if (code < 0xe000 || code > 0xf8ff) return false;
  }
  return true;
}

function normalizedTextCharacters(payloadNode) {
  const characters = String(payloadNode.characters || "");
  const style = payloadNode.textStyle || {};
  const family = String(style.fontFamily || "").toLowerCase();
  if (family.indexOf("material symbols") !== -1 || family.indexOf("material icons") !== -1) {
    return iconLigatureReplacement(characters.trim());
  }
  return privateUseIconReplacement(characters, style.fontFamily);
}

function shouldUseFallbackFontForNormalizedIcon(rawCharacters, normalizedCharacters, fontFamily) {
  if (String(rawCharacters || "") === String(normalizedCharacters || "")) return false;
  const family = String(fontFamily || "").toLowerCase();
  return family.indexOf("material symbols") !== -1 ||
    family.indexOf("material icons") !== -1 ||
    family.indexOf("linearicons") !== -1 ||
    family.indexOf("ionicons") !== -1;
}

function shouldPreserveMeasuredTextBox(payloadNode) {
  const css = payloadNode && payloadNode.css ? payloadNode.css : {};
  const style = payloadNode && payloadNode.textStyle ? payloadNode.textStyle : {};
  const position = String(css.position || "").toLowerCase();
  const fontSize = Number(style.fontSize) || 0;
  const opacity = typeof payloadNode.opacity === "number" ? payloadNode.opacity : 1;
  const cssColor = parseCssColor(css.color);
  const colorOpacity = cssColor ? cssColor.opacity : 1;

  return (
    (position === "absolute" || position === "fixed" || position === "sticky") &&
    fontSize >= 96 &&
    (opacity <= 0.6 || colorOpacity <= 0.6)
  );
}

function payloadTextLooksSingleLine(payloadNode, characters) {
  const style = payloadNode && payloadNode.textStyle ? payloadNode.textStyle : {};
  const lineHeight =
    typeof style.lineHeight === "number" && style.lineHeight > 0
      ? style.lineHeight
      : typeof style.fontSize === "number" && style.fontSize > 0
        ? style.fontSize * 1.2
        : 18;
  return (
    safeSize(payloadNode && payloadNode.height ? payloadNode.height : lineHeight) <= lineHeight * 1.45 ||
    String(characters || "").length <= 28 ||
    !/\s/.test(String(characters || ""))
  );
}

function heightTextResizeWidth(node, payloadNode, textPlan, characters) {
  const plannedWidth = safeSize(textPlan && textPlan.width ? textPlan.width : payloadNode.width);
  if (!payloadTextLooksSingleLine(payloadNode, characters)) return Math.ceil(plannedWidth + 8);

  node.textAutoResize = "WIDTH_AND_HEIGHT";
  const naturalWidth = safeSize(node.width);
  node.textAutoResize = "NONE";

  return Math.ceil(Math.max(plannedWidth, naturalWidth) + 8);
}

function fitSingleLineTextToBrowserWidth(node, payloadNode, characters) {
  if (!node || !payloadNode || !payloadNode.width) return;
  if (!payloadTextLooksSingleLine(payloadNode, characters)) return;
  if (isPrivateUseText(characters)) return;

  const plannedWidth = safeSize(payloadNode.width);
  if (plannedWidth <= 1) return;

  const originalResize = node.textAutoResize;
  node.textAutoResize = "WIDTH_AND_HEIGHT";
  const naturalWidth = safeSize(node.width);
  if (naturalWidth <= plannedWidth * 1.04) {
    node.textAutoResize = originalResize;
    return;
  }

  const fontSize = typeof node.fontSize === "number" ? node.fontSize : Number(payloadNode.textStyle && payloadNode.textStyle.fontSize) || 16;
  const scale = clamp(plannedWidth / naturalWidth, 0.72, 1);
  node.fontSize = Math.max(1, roundPixel(fontSize * scale));
  node.textAutoResize = originalResize;
}

function parseCssColor(value) {
  if (!value || typeof value !== "string") return null;
  const color = value.trim().toLowerCase();
  if (!color || color === "none") return null;
  if (color === "transparent") return { color: { r: 0, g: 0, b: 0 }, opacity: 0 };

  if (color === "white") return { color: { r: 1, g: 1, b: 1 }, opacity: 1 };
  if (color === "black") return { color: { r: 0, g: 0, b: 0 }, opacity: 1 };

  const hex = color.match(/^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i);
  if (hex) {
    let raw = hex[1];
    if (raw.length === 3) raw = raw.split("").map((char) => char + char).join("");
    const r = parseInt(raw.slice(0, 2), 16) / 255;
    const g = parseInt(raw.slice(2, 4), 16) / 255;
    const b = parseInt(raw.slice(4, 6), 16) / 255;
    const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) / 255 : 1;
    return { color: { r, g, b }, opacity: a };
  }

  const cssFunctionParts = (body) => body
    .replace(/\s*\/\s*/g, " / ")
    .replace(/,/g, " ")
    .split(/\s+/)
    .filter((part) => part && part !== "/");
  const alphaPart = (part) => {
    if (part === undefined) return 1;
    if (String(part).endsWith("%")) return clamp(parseFloat(part) / 100, 0, 1);
    return clamp(parseFloat(part), 0, 1);
  };
  const rgbChannel = (part) => {
    if (String(part).endsWith("%")) return clamp(parseFloat(part) / 100, 0, 1);
    return clamp(parseFloat(part) / 255, 0, 1);
  };
  const gammaEncode = (channel) => {
    const value = clamp(channel, 0, 1);
    return value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  };
  const xyzToRgb = (x, y, z) => ({
    r: gammaEncode(3.2409699419 * x - 1.5373831776 * y - 0.4986107603 * z),
    g: gammaEncode(-0.9692436363 * x + 1.8759675015 * y + 0.0415550574 * z),
    b: gammaEncode(0.0556300797 * x - 0.2039769589 * y + 1.0569715142 * z),
  });
  const d50ToD65 = (x, y, z) => ({
    x: 0.9555766 * x - 0.0230393 * y + 0.0631636 * z,
    y: -0.0282895 * x + 1.0099416 * y + 0.0210077 * z,
    z: 0.0122982 * x - 0.0204830 * y + 1.3299098 * z,
  });
  const labLightness = (part) => String(part).endsWith("%")
    ? clamp(parseFloat(part) / 100, 0, 1)
    : clamp(parseFloat(part) / 100, 0, 1);
  const labToRgb = (lightness, a, b) => {
    const l = clamp(lightness, 0, 1) * 100;
    const fy = (l + 16) / 116;
    const fx = fy + a / 500;
    const fz = fy - b / 200;
    const epsilon = 216 / 24389;
    const kappa = 24389 / 27;
    const inverse = (value) => {
      const cube = value * value * value;
      return cube > epsilon ? cube : (116 * value - 16) / kappa;
    };
    const d50 = {
      x: 0.96422 * inverse(fx),
      y: 1 * inverse(fy),
      z: 0.82521 * inverse(fz),
    };
    const d65 = d50ToD65(d50.x, d50.y, d50.z);
    return xyzToRgb(d65.x, d65.y, d65.z);
  };
  const oklabToRgb = (lightness, a, b) => {
    const lPrime = lightness + 0.3963377774 * a + 0.2158037573 * b;
    const mPrime = lightness - 0.1055613458 * a - 0.0638541728 * b;
    const sPrime = lightness - 0.0894841775 * a - 1.2914855480 * b;
    const l = lPrime * lPrime * lPrime;
    const m = mPrime * mPrime * mPrime;
    const s = sPrime * sPrime * sPrime;
    return {
      r: gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s),
    };
  };
  const perceptualLightness = (part) => String(part).endsWith("%")
    ? clamp(parseFloat(part) / 100, 0, 1)
    : clamp(parseFloat(part), 0, 1);

  const rgb = color.match(/^rgba?\(([^)]+)\)$/);
  if (rgb) {
    const parts = cssFunctionParts(rgb[1]);
    if (parts.length >= 3) {
      return {
        color: { r: rgbChannel(parts[0]), g: rgbChannel(parts[1]), b: rgbChannel(parts[2]) },
        opacity: alphaPart(parts[3]),
      };
    }
  }

  const oklab = color.match(/^oklab\(([^)]+)\)$/);
  if (oklab) {
    const parts = cssFunctionParts(oklab[1]);
    if (parts.length >= 3) {
      return {
        color: oklabToRgb(perceptualLightness(parts[0]), parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0),
        opacity: alphaPart(parts[3]),
      };
    }
  }

  const oklch = color.match(/^oklch\(([^)]+)\)$/);
  if (oklch) {
    const parts = cssFunctionParts(oklch[1]);
    if (parts.length >= 3) {
      const hue = (parseFloat(parts[2]) || 0) * Math.PI / 180;
      const chroma = parseFloat(parts[1]) || 0;
      return {
        color: oklabToRgb(perceptualLightness(parts[0]), chroma * Math.cos(hue), chroma * Math.sin(hue)),
        opacity: alphaPart(parts[3]),
      };
    }
  }

  const lab = color.match(/^lab\(([^)]+)\)$/);
  if (lab) {
    const parts = cssFunctionParts(lab[1]);
    if (parts.length >= 3) {
      return {
        color: labToRgb(labLightness(parts[0]), parseFloat(parts[1]) || 0, parseFloat(parts[2]) || 0),
        opacity: alphaPart(parts[3]),
      };
    }
  }

  const lch = color.match(/^lch\(([^)]+)\)$/);
  if (lch) {
    const parts = cssFunctionParts(lch[1]);
    if (parts.length >= 3) {
      const hue = (parseFloat(parts[2]) || 0) * Math.PI / 180;
      const chroma = parseFloat(parts[1]) || 0;
      return {
        color: labToRgb(labLightness(parts[0]), chroma * Math.cos(hue), chroma * Math.sin(hue)),
        opacity: alphaPart(parts[3]),
      };
    }
  }

  const srgb = color.match(/^color\(\s*srgb\s+([^)]+)\)$/);
  if (srgb) {
    const parts = cssFunctionParts(srgb[1]);
    if (parts.length >= 3) {
      return {
        color: {
          r: clamp(parseFloat(parts[0]), 0, 1),
          g: clamp(parseFloat(parts[1]), 0, 1),
          b: clamp(parseFloat(parts[2]), 0, 1),
        },
        opacity: alphaPart(parts[3]),
      };
    }
  }

  return null;
}

function solidPaint(value, opacityOverride) {
  const parsed = parseCssColor(value);
  if (!parsed) return null;
  return {
    type: "SOLID",
    color: parsed.color,
    opacity: opacityOverride === undefined ? parsed.opacity : parsed.opacity * opacityOverride,
  };
}

function cloneSolidPaint(paint) {
  return {
    type: "SOLID",
    color: {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
    },
    opacity: paint.opacity,
  };
}

function clonePlanPaint(paint) {
  if (!paint || paint.type === "IMAGE") return null;
  if (paint.type === "GRADIENT_LINEAR") {
    return {
      type: "GRADIENT_LINEAR",
      gradientStops: (paint.gradientStops || []).map(function (stop) {
        return {
          position: clamp(stop.position, 0, 1),
          color: {
            r: stop.color.r,
            g: stop.color.g,
            b: stop.color.b,
            a: stop.color.a,
          },
        };
      }),
      gradientTransform: paint.gradientTransform || [[1, 0, 0], [0, 1, 0]],
    };
  }
  return {
    type: "SOLID",
    color: {
      r: paint.color.r,
      g: paint.color.g,
      b: paint.color.b,
    },
    opacity: paint.opacity,
  };
}

function gradientPaintFromCss(value) {
  const source = String(value || "");
  if (!/^linear-gradient/i.test(source)) return null;
  const body = source.replace(/^linear-gradient\(/i, "").replace(/\)\s*$/, "");
  const parts = splitCssList(body);
  const stopParts = parts.filter(function (part, index) {
    return index > 0 || !/deg|to\s+/i.test(part);
  });
  const stops = [];
  for (let index = 0; index < stopParts.length; index += 1) {
    const match = stopParts[index].match(/^(.*?)(?:\s+(-?\d*\.?\d+)%)?$/);
    const colorValue = match ? match[1].trim() : stopParts[index].trim();
    const parsed = parseCssColor(colorValue);
    if (!parsed) continue;
    const explicit = match && match[2] !== undefined ? clamp(parseFloat(match[2]) / 100, 0, 1) : null;
    stops.push({
      position: explicit === null ? (stopParts.length <= 1 ? 0 : index / (stopParts.length - 1)) : explicit,
      color: {
        r: parsed.color.r,
        g: parsed.color.g,
        b: parsed.color.b,
        a: parsed.opacity,
      },
    });
  }
  if (stops.length < 2) return null;
  const degrees = gradientDegreesFromCss(source);
  const radians = (degrees - 90) * Math.PI / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  return {
    type: "GRADIENT_LINEAR",
    gradientStops: stops,
    gradientTransform: [[cos, sin, 0], [-sin, cos, 0]],
  };
}

function gradientDegreesFromCss(value) {
  const source = String(value || "");
  const angleMatch = source.match(/linear-gradient\(\s*(-?\d*\.?\d+)deg/i);
  if (angleMatch) return parseFloat(angleMatch[1]);
  const directionMatch = source.match(/linear-gradient\(\s*to\s+([^,]+)/i);
  if (!directionMatch) return 180;
  const direction = directionMatch[1].trim().toLowerCase();
  if (direction === "top") return 0;
  if (direction === "right") return 90;
  if (direction === "bottom") return 180;
  if (direction === "left") return 270;
  if (direction === "top right" || direction === "right top") return 45;
  if (direction === "bottom right" || direction === "right bottom") return 135;
  if (direction === "bottom left" || direction === "left bottom") return 225;
  if (direction === "top left" || direction === "left top") return 315;
  return 180;
}

function imageScaleModeForPayload(payloadNode) {
  const css = payloadNode && payloadNode.css ? payloadNode.css : {};
  const objectFit = String(css.objectFit || "").toLowerCase();
  return objectFit === "contain" || objectFit === "scale-down" ? "FIT" : "FILL";
}

function cloneImageFilters(filters) {
  if (!filters || typeof filters !== "object") return undefined;
  const result = {};
  const keys = ["exposure", "contrast", "saturation", "temperature", "tint", "highlights", "shadows"];
  for (const key of keys) {
    const value = Number(filters[key]);
    if (Number.isFinite(value) && Math.abs(value) > 0.001) {
      result[key] = clamp(value, -1, 1);
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function clonePlanEffect(effect) {
  if (!effect) return null;
  const clone = {
    type: effect.type,
    radius: Number(effect.radius) || 0,
    visible: effect.visible !== false,
  };
  if (effect.color) {
    clone.color = {
      r: effect.color.r,
      g: effect.color.g,
      b: effect.color.b,
      a: effect.color.a,
    };
  }
  if (effect.offset) {
    clone.offset = {
      x: Number(effect.offset.x) || 0,
      y: Number(effect.offset.y) || 0,
    };
  }
  if (effect.blendMode) clone.blendMode = effect.blendMode;
  if (effect.showShadowBehindNode !== undefined) clone.showShadowBehindNode = effect.showShadowBehindNode;
  if (effect.spread !== undefined) clone.spread = Number(effect.spread) || 0;
  return clone;
}

function importPlanForNode(payloadNode) {
  return payloadNode && payloadNode.importPlan ? payloadNode.importPlan : null;
}

function colorForEffect(value) {
  const parsed = parseCssColor(value) || { color: { r: 0, g: 0, b: 0 }, opacity: 0.18 };
  return {
    r: parsed.color.r,
    g: parsed.color.g,
    b: parsed.color.b,
    a: parsed.opacity,
  };
}

function cssColorToSvgPaint(value) {
  const parsed = parseCssColor(value);
  if (!parsed) return null;
  const r = Math.round(clamp(parsed.color.r, 0, 1) * 255);
  const g = Math.round(clamp(parsed.color.g, 0, 1) * 255);
  const b = Math.round(clamp(parsed.color.b, 0, 1) * 255);
  const alpha = clamp(parsed.opacity, 0, 1);
  if (alpha < 0.999) {
    return "rgba(" + r + ", " + g + ", " + b + ", " + roundPixel(alpha) + ")";
  }
  return "rgb(" + r + ", " + g + ", " + b + ")";
}

function numberAttribute(attrs, name) {
  const pattern = new RegExp("\\b" + name + "=[\"']?(-?\\d*\\.?\\d+)", "i");
  const match = String(attrs || "").match(pattern);
  return match ? Number(match[1]) : 0;
}

function svgViewportBox(source, targetWidth, targetHeight) {
  const rootMatch = String(source || "").match(/<svg\b([^>]*)>/i);
  const attrs = rootMatch ? rootMatch[1] : "";
  const viewBoxMatch = attrs.match(/\bviewBox=["']\s*(-?\d*\.?\d+)[,\s]+(-?\d*\.?\d+)[,\s]+(\d*\.?\d+)[,\s]+(\d*\.?\d+)/i);

  if (viewBoxMatch) {
    return {
      x: Number(viewBoxMatch[1]) || 0,
      y: Number(viewBoxMatch[2]) || 0,
      width: Math.max(1, Number(viewBoxMatch[3]) || 1),
      height: Math.max(1, Number(viewBoxMatch[4]) || 1),
    };
  }

  return {
    x: 0,
    y: 0,
    width: Math.max(1, numberAttribute(attrs, "width") || Number(targetWidth) || 1),
    height: Math.max(1, numberAttribute(attrs, "height") || Number(targetHeight) || 1),
  };
}

function setSvgAttribute(attrs, name, value) {
  const pattern = new RegExp("(^|\\s)" + name + "=(\"[^\"]*\"|'[^']*'|[^\\s>]+)", "i");
  if (pattern.test(attrs)) {
    return attrs.replace(pattern, "$1" + name + '="' + value + '"');
  }
  return attrs + " " + name + '="' + value + '"';
}

function normalizeCompactSvgRootSize(source, targetWidth, targetHeight) {
  const width = Number(targetWidth) || 0;
  const height = Number(targetHeight) || 0;
  if (width <= 0 || height <= 0 || width > 96 || height > 96) return source;

  return String(source || "").replace(/<svg\b([^>]*)>/i, function (_match, attrs) {
    let nextAttrs = attrs || "";
    nextAttrs = setSvgAttribute(nextAttrs, "width", String(roundPixel(width)));
    nextAttrs = setSvgAttribute(nextAttrs, "height", String(roundPixel(height)));
    if (!/\bpreserveAspectRatio=/i.test(nextAttrs)) {
      nextAttrs += ' preserveAspectRatio="xMidYMid meet"';
    }
    return "<svg" + nextAttrs + ">";
  });
}

function addCompactSvgViewportRect(source, targetWidth, targetHeight) {
  const width = Number(targetWidth) || 0;
  const height = Number(targetHeight) || 0;
  if (width <= 0 || height <= 0 || width > 96 || height > 96) return source;
  if (!/<svg\b/i.test(source) || /data-dmaya-svg-viewport/i.test(source)) return source;

  const box = svgViewportBox(source, width, height);
  const rect = '<rect data-dmaya-svg-viewport="true" x="' + roundPixel(box.x) +
    '" y="' + roundPixel(box.y) +
    '" width="' + roundPixel(box.width) +
    '" height="' + roundPixel(box.height) +
    '" fill="#000000" opacity="0.001"/>';

  return source.replace(/(<svg\b[^>]*>)/i, "$1" + rect);
}

function bakeSvgRotation(source, rotation, targetWidth, targetHeight) {
  const degrees = Number(rotation) || 0;
  const width = Number(targetWidth) || 0;
  const height = Number(targetHeight) || 0;
  if (Math.abs(degrees) < 0.01) return source;
  if (width <= 0 || height <= 0 || Math.abs(width - height) > 1) return source;
  if (!/<svg\b/i.test(source) || /data-dmaya-svg-rotation/i.test(source)) return source;

  const box = svgViewportBox(source, width, height);
  const centerX = roundPixel(box.x + box.width / 2);
  const centerY = roundPixel(box.y + box.height / 2);
  const roundedDegrees = roundPixel(degrees);
  const openMatch = String(source || "").match(/<svg\b[^>]*>/i);
  if (!openMatch) return source;

  const openTag = openMatch[0];
  const start = openMatch.index + openTag.length;
  const closeIndex = source.toLowerCase().lastIndexOf("</svg>");
  if (closeIndex <= start) return source;

  return source.slice(0, start) +
    '<g data-dmaya-svg-rotation="true" transform="rotate(' + roundedDegrees + " " + centerX + " " + centerY + ')">' +
    source.slice(start, closeIndex) +
    "</g>" +
    source.slice(closeIndex);
}

function normalizeSvgMarkupForFigma(svg, cssColor, targetWidth, targetHeight, rotation) {
  const cssPaint = cssColorToSvgPaint(cssColor);
  let source = String(svg || "");
  if (cssPaint) {
    source = source.replace(/currentcolor/gi, cssPaint);
  }

  source = source.replace(/\b(?:oklab|oklch|lab|lch|color)\([^)]*\)/gi, function (match) {
    return cssColorToSvgPaint(match) || match;
  });

  source = normalizeCompactSvgRootSize(source, targetWidth, targetHeight);
  source = bakeSvgRotation(source, rotation, targetWidth, targetHeight);
  return addCompactSvgViewportRect(source, targetWidth, targetHeight);
}

function dataUrlToBytes(dataUrl) {
  const commaIndex = dataUrl.indexOf(",");
  if (commaIndex < 0) throw new Error("Invalid data URL.");
  const header = dataUrl.slice(0, commaIndex);
  const data = dataUrl.slice(commaIndex + 1);
  if (!/;base64/i.test(header)) throw new Error("Only base64 data URLs are supported.");
  return figma.base64Decode(data);
}

function reportProgress(context, message, force) {
  if (!context || !context.progress) return;
  const now = Date.now();
  const total = Math.max(1, context.progress.total || 1);
  const percent = Math.min(98, Math.max(1, Math.round((context.progress.completed / total) * 96)));
  if (!force && percent === context.progress.lastPercent && now - context.progress.lastAt < 350) return;
  context.progress.lastPercent = percent;
  context.progress.lastAt = now;
  figma.ui.postMessage({
    type: "import-progress",
    percent: percent,
    message: message || "Importing layers...",
  });
}

function advanceProgress(context, amount, message) {
  if (!context || !context.progress) return;
  context.progress.completed = Math.min(
    Math.max(1, context.progress.total || 1),
    context.progress.completed + Math.max(1, amount || 1)
  );
  reportProgress(context, message, false);
}

function assetFailureLabel(asset) {
  if (!asset) return "Unknown asset";
  let host = "";
  if (asset.url) {
    try {
      host = " from " + new URL(asset.url).host;
    } catch (error) {
      host = "";
    }
  }
  return String(asset.name || asset.id || "Image asset") + host;
}

function recordRemoteAssetFailure(context, asset, error) {
  if (!context || !context.stats) return;
  const message = error && error.message ? error.message : String(error || "Unknown error");
  context.stats.remoteAssetFailures += 1;
  if (context.stats.remoteAssetFailureDetails.length < 5) {
    context.stats.remoteAssetFailureDetails.push(assetFailureLabel(asset) + ": " + message);
  }
}

async function bytesForAsset(asset, context) {
  if (asset.dataUrl) return dataUrlToBytes(asset.dataUrl);
  if (!asset.url) return null;

  context.stats.remoteAssetFetches += 1;
  const response = await fetch(asset.url);
  if (!response.ok) {
    throw new Error("Temporary asset could not be downloaded. It may have expired.");
  }
  return new Uint8Array(await response.arrayBuffer());
}

async function createImageForAsset(asset, context) {
  const mimeType = String(asset.mimeType || "").toLowerCase();
  if (asset.url && REMOTE_IMAGE_MIME_TYPES.includes(mimeType)) {
    try {
      const bytes = await bytesForAsset(asset, context);
      if (bytes) return figma.createImage(bytes);
    } catch (error) {
      if (context.stats.remoteAssetFailureDetails.length < 5) {
        const message = error && error.message ? error.message : String(error || "Unknown error");
        context.stats.remoteAssetFailureDetails.push(assetFailureLabel(asset) + " fetch fallback: " + message);
      }
    }
  }

  if (asset.url && REMOTE_IMAGE_MIME_TYPES.includes(mimeType) && typeof figma.createImageAsync === "function") {
    try {
      context.stats.remoteAssetFetches += 1;
      context.stats.remoteAssetAsyncFallbacks += 1;
      return await figma.createImageAsync(asset.url);
    } catch (error) {
      if (context.stats.remoteAssetFailureDetails.length < 5) {
        const message = error && error.message ? error.message : String(error || "Unknown error");
        context.stats.remoteAssetFailureDetails.push(assetFailureLabel(asset) + " createImageAsync fallback: " + message);
      }
    }
  }

  const bytes = await bytesForAsset(asset, context);
  if (!bytes) return null;
  return figma.createImage(bytes);
}

function parseVersion(value) {
  return String(value || "0")
    .split(".")
    .slice(0, 3)
    .map(function (part) {
      const number = parseInt(part.replace(/[^0-9].*$/, ""), 10);
      return Number.isFinite(number) ? number : 0;
    });
}

function compareVersions(left, right) {
  const a = parseVersion(left);
  const b = parseVersion(right);
  for (let index = 0; index < 3; index += 1) {
    const delta = (a[index] || 0) - (b[index] || 0);
    if (delta !== 0) return delta;
  }
  return 0;
}

function assertPayloadCompatibility(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Missing payload.");

  const payloadVersion = String(payload.version || "");
  if (payloadVersion !== SUPPORTED_PAYLOAD_VERSION) {
    throw new Error(
      "This payload uses an unsupported dMaya payload format. Update HTML to Figma by dMaya and try again."
    );
  }

  const minPluginVersion = payload.minPluginVersion || payload.requiredPluginVersion;
  if (minPluginVersion && compareVersions(PLUGIN_VERSION, minPluginVersion) < 0) {
    throw new Error(
      "This payload requires HTML to Figma by dMaya v" + minPluginVersion +
      " or newer. Update the plugin and try again."
    );
  }

  const importPlanVersion = payload.backendImportPlanVersion;
  if (importPlanVersion && importPlanVersion !== SUPPORTED_BACKEND_IMPORT_PLAN_VERSION) {
    throw new Error(
      "This payload was generated for a newer dMaya import engine. Update HTML to Figma by dMaya and try again."
    );
  }

  return payload;
}

function normalizePayload(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Missing payload.");
  if (raw.pluginPayload && raw.pluginPayload.document && Array.isArray(raw.pluginPayload.assets)) {
    return assertPayloadCompatibility(raw.pluginPayload);
  }
  if (raw.version === "html-to-figma-plugin-payload-v1" && raw.document && Array.isArray(raw.assets)) {
    return assertPayloadCompatibility(raw);
  }
  if (raw.figma && Array.isArray(raw.assets)) {
    return assertPayloadCompatibility({
      version: SUPPORTED_PAYLOAD_VERSION,
      importMode: raw.meta && raw.meta.mode ? raw.meta.mode : "hybrid",
      document: raw.figma,
      assets: raw.assets,
    });
  }
  throw new Error("This JSON is not a dMaya HTML-to-Figma payload.");
}

function canHaveChildren(node) {
  return node && ["FRAME", "GROUP", "COMPONENT", "INSTANCE", "SECTION"].includes(node.type);
}

function parentCanAcceptChildren(node) {
  return node && typeof node.appendChild === "function";
}

function maxCornerRadiusForNode(payloadNode) {
  return Math.max(0, Math.min(safeSize(payloadNode.width), safeSize(payloadNode.height)) / 2);
}

function applyCornerRadii(sceneNode, payloadNode) {
  const maxRadius = maxCornerRadiusForNode(payloadNode);
  const clampedRadius = function (value) {
    return Math.min(Math.max(0, Number(value) || 0), maxRadius);
  };

  if ("cornerRadius" in sceneNode && typeof payloadNode.cornerRadius === "number") {
    sceneNode.cornerRadius = clampedRadius(payloadNode.cornerRadius);
  }
  if (Array.isArray(payloadNode.cornerRadii) && "topLeftRadius" in sceneNode) {
    sceneNode.topLeftRadius = clampedRadius(payloadNode.cornerRadii[0]);
    sceneNode.topRightRadius = clampedRadius(payloadNode.cornerRadii[1]);
    sceneNode.bottomRightRadius = clampedRadius(payloadNode.cornerRadii[2]);
    sceneNode.bottomLeftRadius = clampedRadius(payloadNode.cornerRadii[3]);
  }
}

function actualCornerRadiusForNode(payloadNode) {
  if (!payloadNode) return 0;
  let radius = Math.max(0, Number(payloadNode.cornerRadius) || 0);
  if (Array.isArray(payloadNode.cornerRadii)) {
    for (const value of payloadNode.cornerRadii) {
      radius = Math.max(radius, Math.max(0, Number(value) || 0));
    }
  }
  return Math.min(radius, maxCornerRadiusForNode(payloadNode));
}

function applyCommonProperties(sceneNode, payloadNode) {
  sceneNode.name = String(payloadNode.name || payloadNode.type || "Layer").slice(0, 120);
  sceneNode.x = Number(payloadNode.x) || 0;
  sceneNode.y = Number(payloadNode.y) || 0;
  if (payloadNode.width || payloadNode.height) {
    sceneNode.resizeWithoutConstraints(safeSize(payloadNode.width), safeSize(payloadNode.height));
  }
  if (typeof payloadNode.opacity === "number") sceneNode.opacity = clamp(payloadNode.opacity, 0, 1);
  if (typeof payloadNode.rotation === "number") sceneNode.rotation = payloadNode.rotation;
  if (typeof payloadNode.visible === "boolean") sceneNode.visible = payloadNode.visible;
  if (typeof payloadNode.locked === "boolean") sceneNode.locked = payloadNode.locked;

  applyCornerRadii(sceneNode, payloadNode);
}

function overflowValueClips(value) {
  const normalized = String(value || "").toLowerCase();
  return normalized !== "" &&
    normalized !== "visible" &&
    normalized !== "initial" &&
    normalized !== "inherit" &&
    normalized !== "unset";
}

function childOverflowStats(payloadNode) {
  const stats = {
    overflows: false,
    count: 0,
    max: 0,
    nonTextChildren: 0,
  };

  if (!payloadNode || !Array.isArray(payloadNode.children) || payloadNode.children.length === 0) return stats;
  const width = safeSize(payloadNode.width);
  const height = safeSize(payloadNode.height);

  for (const child of payloadNode.children) {
    if (!child) continue;
    if (child.type !== "TEXT") stats.nonTextChildren += 1;
    const x = Number(child.x) || 0;
    const y = Number(child.y) || 0;
    const childWidth = safeSize(child.width);
    const childHeight = safeSize(child.height);
    const overflow = Math.max(
      Math.max(0, -x),
      Math.max(0, -y),
      Math.max(0, x + childWidth - width),
      Math.max(0, y + childHeight - height)
    );

    if (overflow > 2) {
      stats.overflows = true;
      stats.count += 1;
      stats.max = Math.max(stats.max, overflow);
    }
  }

  return stats;
}

function childBoundsOverflowParent(payloadNode) {
  return childOverflowStats(payloadNode).overflows;
}

function childTouchesRoundedClipEdge(payloadNode) {
  if (!payloadNode || !Array.isArray(payloadNode.children) || payloadNode.children.length === 0) return false;
  const radius = actualCornerRadiusForNode(payloadNode);
  if (radius <= 0) return false;

  const width = safeSize(payloadNode.width);
  const height = safeSize(payloadNode.height);
  const edgeTolerance = Math.min(4, Math.max(1, radius / 4));

  for (const child of payloadNode.children) {
    if (!child) continue;
    const x = Number(child.x) || 0;
    const y = Number(child.y) || 0;
    const childWidth = safeSize(child.width);
    const childHeight = safeSize(child.height);
    const touchesHorizontalEdge = x <= edgeTolerance || x + childWidth >= width - edgeTolerance;
    const touchesVerticalEdge = y <= edgeTolerance || y + childHeight >= height - edgeTolerance;
    if (touchesHorizontalEdge && touchesVerticalEdge) {
      return true;
    }
  }

  return false;
}

function nodeHasClipBoundary(payloadNode) {
  if (!payloadNode) return false;
  if (hasVisibleFill(payloadNode)) return true;
  if (hasBorderSides(payloadNode)) return true;
  if (Array.isArray(payloadNode.strokes) && payloadNode.strokes.length > 0) return true;
  if (actualCornerRadiusForNode(payloadNode) > 0) return true;
  return false;
}

function transparentOverflowNameLooksSafe(payloadNode) {
  const name = String(payloadNode && payloadNode.name ? payloadNode.name : "").toLowerCase();
  if (!name) return false;
  if (name === "body" || name.indexOf("section") === 0) return false;

  return name.indexOf("overflow") !== -1 ||
    name.indexOf("space-y") !== -1 ||
    name.indexOf("flex-1") !== -1 ||
    name.indexOf("min-h-0") !== -1 ||
    name.indexOf("max-h") !== -1 ||
    name.indexOf("scroll") !== -1 ||
    name.indexOf("h-[") !== -1;
}

function shouldInferTransparentOverflowClip(payloadNode, stats) {
  if (!payloadNode || nodeHasClipBoundary(payloadNode)) return false;
  if (!Array.isArray(payloadNode.children) || payloadNode.children.length < 3) return false;
  if (!stats || !stats.overflows || stats.count < 1 || stats.max < 8 || stats.nonTextChildren < 3) return false;
  if (safeSize(payloadNode.width) < 24 || safeSize(payloadNode.height) < 24) return false;
  return transparentOverflowNameLooksSafe(payloadNode);
}

function shouldInferClipFromGeometry(payloadNode) {
  if (!payloadNode || payloadNode.type === "DOCUMENT" || payloadNode.type === "PAGE") return false;
  if (String(payloadNode.name || "").toLowerCase() === "body") return false;
  const stats = childOverflowStats(payloadNode);

  if (nodeHasClipBoundary(payloadNode)) {
    return stats.overflows || childTouchesRoundedClipEdge(payloadNode);
  }

  return shouldInferTransparentOverflowClip(payloadNode, stats);
}

function clipReasonForNode(payloadNode) {
  const plan = importPlanForNode(payloadNode);
  if (plan && plan.clip && typeof plan.clip.enabled === "boolean") {
    return plan.clip.enabled ? String(plan.clip.reason || "payload") : "";
  }
  if (payloadNode && payloadNode.clipsContent === true) return "payload";
  const css = payloadNode && payloadNode.css ? payloadNode.css : {};
  if (overflowValueClips(css.overflowX) || overflowValueClips(css.overflowY)) return "css-overflow";
  return shouldInferClipFromGeometry(payloadNode) ? "geometry" : "";
}

function nodeShouldClip(payloadNode) {
  return !!clipReasonForNode(payloadNode);
}

function shadowSpreadAllowedOnFrame(payloadNode) {
  return nodeShouldClip(payloadNode) && hasVisibleFill(payloadNode);
}

function applyClipBehavior(sceneNode, payloadNode, hasContentClip) {
  if ("clipsContent" in sceneNode) {
    sceneNode.clipsContent = nodeShouldClip(payloadNode);
  }
}

function mapPrimaryAxisAlign(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "center") return "CENTER";
  if (normalized === "flex-end" || normalized === "end" || normalized === "right") return "MAX";
  if (normalized === "space-between") return "SPACE_BETWEEN";
  return "MIN";
}

function mapCounterAxisAlign(value) {
  const normalized = String(value || "").toLowerCase();
  if (normalized === "center") return "CENTER";
  if (normalized === "flex-end" || normalized === "end" || normalized === "bottom" || normalized === "right") {
    return "MAX";
  }
  return "MIN";
}

function fitAutoLayoutFrameToChildren(frameNode) {
  if (!frameNode || !frameNode.children || frameNode.children.length === 0) return;
  const children = frameNode.children.filter(function (child) {
    return !("layoutPositioning" in child) || child.layoutPositioning !== "ABSOLUTE";
  });
  if (children.length === 0) return;

  const itemSpacing = Math.max(0, Number(frameNode.itemSpacing) || 0);
  const paddingX = Math.max(0, Number(frameNode.paddingLeft) || 0) + Math.max(0, Number(frameNode.paddingRight) || 0);
  const paddingY = Math.max(0, Number(frameNode.paddingTop) || 0) + Math.max(0, Number(frameNode.paddingBottom) || 0);
  const contentWidth = children.reduce(function (total, child) {
    return total + safeSize(child.width);
  }, 0);
  const contentHeight = children.reduce(function (max, child) {
    return Math.max(max, safeSize(child.height));
  }, 0);
  const neededWidth = Math.ceil(contentWidth + itemSpacing * Math.max(0, children.length - 1) + paddingX);
  const neededHeight = Math.ceil(contentHeight + paddingY);
  const nextWidth = Math.max(safeSize(frameNode.width), neededWidth);
  const nextHeight = Math.max(safeSize(frameNode.height), neededHeight);

  if (nextWidth > safeSize(frameNode.width) || nextHeight > safeSize(frameNode.height)) {
    frameNode.resizeWithoutConstraints(nextWidth, nextHeight);
  }
}

function sortAutoLayoutChildrenByPosition(frameNode, layoutMode) {
  if (!frameNode || !frameNode.children || frameNode.children.length < 2) return;
  const autoChildren = frameNode.children.filter(function (child) {
    return !("layoutPositioning" in child) || child.layoutPositioning !== "ABSOLUTE";
  });
  if (autoChildren.length < 2) return;
  const children = autoChildren.slice();
  children.sort(function (left, right) {
    const primaryDelta = layoutMode === "VERTICAL"
      ? (Number(left.y) || 0) - (Number(right.y) || 0)
      : (Number(left.x) || 0) - (Number(right.x) || 0);
    if (Math.abs(primaryDelta) > 0.5) return primaryDelta;
    return layoutMode === "VERTICAL"
      ? (Number(left.x) || 0) - (Number(right.x) || 0)
      : (Number(left.y) || 0) - (Number(right.y) || 0);
  });
  for (const child of children) {
    frameNode.appendChild(child);
  }
}

function payloadChildShouldStayAbsolute(child) {
  const css = child && child.css ? child.css : {};
  const position = String(css.position || "").toLowerCase();
  const sourceUid = String(child && child.sourceUid ? child.sourceUid : "");
  return position === "absolute" || position === "fixed" || sourceUid.indexOf("_pseudo_") !== -1;
}

function payloadDisplayIsInline(value) {
  const display = String(value || "").toLowerCase();
  return display === "inline" || display === "inline-block" || display === "inline-flex";
}

function prepareAutoLayoutChildren(frameNode, payloadNode, layoutMode) {
  if (!frameNode || !frameNode.children || frameNode.children.length < 2) return [];
  const payloadChildren = payloadNode && payloadNode.children ? payloadNode.children : [];
  const prepared = frameNode.children.map(function (child, index) {
    const payloadChild = payloadChildren[index] || {};
    const childName = String(child.name || "").toLowerCase();
    return {
      node: child,
      x: Number(child.x) || 0,
      y: Number(child.y) || 0,
      absolute: childName.indexOf(" pseudo") !== -1 || payloadChildShouldStayAbsolute(payloadChild),
    };
  });

  prepared.sort(function (left, right) {
    if (left.absolute !== right.absolute) return left.absolute ? 1 : -1;
    const primaryDelta = layoutMode === "VERTICAL" ? left.y - right.y : left.x - right.x;
    if (Math.abs(primaryDelta) > 0.5) return primaryDelta;
    return layoutMode === "VERTICAL" ? left.x - right.x : left.y - right.y;
  });

  for (const item of prepared) {
    frameNode.appendChild(item.node);
  }

  return prepared;
}

function applyAutoLayoutChildPositioning(preparedChildren) {
  for (const item of preparedChildren || []) {
    const child = item.node;
    if (!child || !("layoutPositioning" in child)) continue;
    child.layoutPositioning = item.absolute ? "ABSOLUTE" : "AUTO";
    if (item.absolute) {
      child.x = item.x;
      child.y = item.y;
    }
  }
}

function collectTextFragments(payloadNode, out) {
  const fragments = out || [];
  if (payloadNode && payloadNode.type === "TEXT" && payloadNode.characters) {
    fragments.push(String(payloadNode.characters));
  }
  for (const child of payloadNode && payloadNode.children || []) {
    collectTextFragments(child, fragments);
  }
  return fragments;
}

function hasNonTextVisualContent(payloadNode) {
  if (!payloadNode) return false;
  if (payloadNode.type === "IMAGE" || payloadNode.type === "VECTOR" || payloadNode.svg || payloadNode.imageRef) return true;
  if (hasVisibleFill(payloadNode) || hasVisibleNodeFill(payloadNode) || actualCornerRadiusForNode(payloadNode) > 0) return true;
  return (payloadNode.children || []).some(function (child) {
    return hasNonTextVisualContent(child);
  });
}

function isInlineTextLikeChild(payloadNode) {
  return payloadNode &&
    (payloadNode.type === "TEXT" ||
      (payloadDisplayIsInline(payloadNode.css && payloadNode.css.display) && !hasNonTextVisualContent(payloadNode)));
}

function isCompactInlineWordmark(payloadNode, children, display) {
  if (display !== "inline-flex" && display !== "flex") return false;
  if (hasVisibleFill(payloadNode) || hasVisibleNodeFill(payloadNode) || actualCornerRadiusForNode(payloadNode) > 0) return false;
  if (!children || children.length <= 1 || children.length > 4) return false;
  if (!children.every(isInlineTextLikeChild)) return false;
  const fragments = collectTextFragments(payloadNode).filter(function (fragment) {
    return fragment.length > 0;
  });
  const combined = fragments.join("");
  return fragments.length > 1 && combined.length <= 32 && !/\s/.test(combined);
}

function isAutoLayoutCandidate(payloadNode) {
  if (!payloadNode || !payloadNode.layoutHints || payloadNode.layoutMode !== "HORIZONTAL") return false;
  const children = (payloadNode.children || []).filter(function (child) {
    return !payloadChildShouldStayAbsolute(child);
  });
  if (children.length === 0 || children.length > 8) return false;

  const hints = payloadNode.layoutHints;
  const display = String(hints.display || "").toLowerCase();
  const alignItems = String(hints.alignItems || "").toLowerCase();
  const justifyContent = String(hints.justifyContent || "").toLowerCase();
  const height = safeSize(payloadNode.height);
  const width = safeSize(payloadNode.width);
  const paddingX = Math.max(0, Number(hints.paddingLeft) || 0) + Math.max(0, Number(hints.paddingRight) || 0);
  const spacing = Math.max(0, Number(hints.columnGap || hints.gap) || 0);
  const childWidth = children.reduce((total, child) => total + safeSize(child.width), 0);
  const expectedWidth = childWidth + spacing * Math.max(0, children.length - 1) + paddingX;
  const tightlyPacked = Math.abs(width - expectedWidth) <= 3;
  const inlineTextLogo = isCompactInlineWordmark(payloadNode, children, display);
  const buttonLikeRow = (display === "flex" || display === "inline-flex") &&
    alignItems === "center" &&
    children.length <= 4 &&
    width <= 420 &&
    height <= 80 &&
    (hasVisibleFill(payloadNode) || hasVisibleNodeFill(payloadNode) || actualCornerRadiusForNode(payloadNode) > 0) &&
    (justifyContent === "center" || tightlyPacked);
  const smallChip = display === "inline-flex" && width <= 260 && height <= 48 && !inlineTextLogo;
  const smallBulletRow = alignItems === "center" && children.length <= 3 && width <= 280 && height <= 36 && tightlyPacked;
  const sectionEyebrow = alignItems === "center" && children.length <= 3 && width <= 180 && height <= 28 && tightlyPacked;

  if (justifyContent === "space-between") return false;

  return buttonLikeRow || smallChip || smallBulletRow || sectionEyebrow;
}

function applyAutoLayoutIfSafe(frameNode, payloadNode) {
  if (!("layoutMode" in frameNode)) return false;

  const plan = importPlanForNode(payloadNode);
  const autoLayoutPlan = plan && plan.layout && plan.layout.autoLayout ? plan.layout.autoLayout : null;
  if (autoLayoutPlan) {
    if (autoLayoutPlan.enabled) {
      const plannedLayoutMode = autoLayoutPlan.layoutMode || "HORIZONTAL";
      const preparedChildren = prepareAutoLayoutChildren(frameNode, payloadNode, plannedLayoutMode);
      frameNode.layoutMode = plannedLayoutMode;
      frameNode.primaryAxisSizingMode = autoLayoutPlan.primaryAxisSizingMode || "FIXED";
      frameNode.counterAxisSizingMode = autoLayoutPlan.counterAxisSizingMode || "FIXED";
      frameNode.primaryAxisAlignItems = autoLayoutPlan.primaryAxisAlignItems || "MIN";
      frameNode.counterAxisAlignItems = autoLayoutPlan.counterAxisAlignItems || "MIN";
      frameNode.itemSpacing = Math.max(0, Number(autoLayoutPlan.itemSpacing) || 0);
      frameNode.paddingTop = Math.max(0, Number(autoLayoutPlan.paddingTop) || 0);
      frameNode.paddingRight = Math.max(0, Number(autoLayoutPlan.paddingRight) || 0);
      frameNode.paddingBottom = Math.max(0, Number(autoLayoutPlan.paddingBottom) || 0);
      frameNode.paddingLeft = Math.max(0, Number(autoLayoutPlan.paddingLeft) || 0);

      applyAutoLayoutChildPositioning(preparedChildren);

      fitAutoLayoutFrameToChildren(frameNode);
      return true;
    }
    return false;
  }

  if (!isAutoLayoutCandidate(payloadNode)) return false;

  const hints = payloadNode.layoutHints || {};
  const preparedChildren = prepareAutoLayoutChildren(frameNode, payloadNode, "HORIZONTAL");
  frameNode.layoutMode = "HORIZONTAL";
  frameNode.primaryAxisSizingMode = "FIXED";
  frameNode.counterAxisSizingMode = "FIXED";
  frameNode.primaryAxisAlignItems = mapPrimaryAxisAlign(hints.justifyContent);
  frameNode.counterAxisAlignItems = mapCounterAxisAlign(hints.alignItems);
  const itemSpacing = hints.columnGap !== undefined && hints.columnGap !== null
    ? hints.columnGap
    : hints.gap;
  frameNode.itemSpacing = Math.max(0, Number(itemSpacing) || 0);
  frameNode.paddingTop = Math.max(0, Number(hints.paddingTop) || 0);
  frameNode.paddingRight = Math.max(0, Number(hints.paddingRight) || 0);
  frameNode.paddingBottom = Math.max(0, Number(hints.paddingBottom) || 0);
  frameNode.paddingLeft = Math.max(0, Number(hints.paddingLeft) || 0);

  applyAutoLayoutChildPositioning(preparedChildren);

  fitAutoLayoutFrameToChildren(frameNode);

  return true;
}

function payloadFrameTextLooksSingleLine(payloadNode) {
  const child = payloadNode && payloadNode.children && payloadNode.children[0];
  if (!child || child.type !== "TEXT") return false;
  const style = child.textStyle || {};
  const characters = String(child.characters || "");
  const lineHeight =
    typeof style.lineHeight === "number" && style.lineHeight > 0
      ? style.lineHeight
      : typeof style.fontSize === "number" && style.fontSize > 0
        ? style.fontSize * 1.2
        : safeSize(child.height || payloadNode.height);

  return safeSize(child.height) <= lineHeight * 1.5 || characters.length <= 48 || !/\s/.test(characters);
}

function centerSingleTextChildIfSafe(frameNode, payloadNode) {
  if (!frameNode || !("children" in frameNode)) return;
  if (!payloadNode || !Array.isArray(payloadNode.children) || payloadNode.children.length !== 1) return;
  const plan = importPlanForNode(payloadNode);
  const centerPlan = plan && plan.layout && plan.layout.centerSingleTextChild ? plan.layout.centerSingleTextChild : null;
  if (centerPlan) {
    if (!centerPlan.enabled) return;
    const plannedChild = frameNode.children[0];
    if (!plannedChild || plannedChild.type !== "TEXT") return;
    plannedChild.y = typeof centerPlan.childY === "number"
      ? roundPixel(centerPlan.childY)
      : roundPixel((safeSize(frameNode.height) - safeSize(plannedChild.height)) / 2);
    return;
  }
  if (!payloadFrameTextLooksSingleLine(payloadNode)) return;

  const child = frameNode.children[0];
  if (!child || child.type !== "TEXT") return;
  if (safeSize(frameNode.height) > 96) return;
  if (safeSize(child.height) > safeSize(frameNode.height)) return;

  child.y = roundPixel((safeSize(frameNode.height) - safeSize(child.height)) / 2);
}

function centerInlineControlChildrenVertically(frameNode, payloadNode) {
  if (!frameNode || !frameNode.children || frameNode.children.length < 2) return;
  if (!payloadNode || !Array.isArray(payloadNode.children) || payloadNode.children.length < 2) return;
  const css = payloadNode.css || {};
  const display = String(css.display || "").toLowerCase();
  const height = safeSize(frameNode.height);
  if (height > 72 || (display !== "inline" && display !== "inline-block" && display !== "inline-flex")) return;
  if (!hasVisibleFill(payloadNode) && !hasBorderSides(payloadNode) && actualCornerRadiusForNode(payloadNode) <= 0) return;

  const eligibleChildren = frameNode.children.filter(function (child) {
    if (!child || child.visible === false) return false;
    if ("layoutPositioning" in child && child.layoutPositioning === "ABSOLUTE") return false;
    if (child.type === "TEXT" || child.type === "IMAGE" || child.type === "VECTOR") return true;
    if (child.type === "FRAME" && child.children && child.children.length === 1) return true;
    return false;
  });
  if (eligibleChildren.length < 2) return;

  for (const child of eligibleChildren) {
    const childHeight = safeSize(child.height);
    if (childHeight <= 0 || childHeight > height + 2) continue;
    child.y = roundPixel((height - childHeight) / 2);
  }
}

async function imageHashForAsset(assetId, context) {
  if (!assetId) return null;
  if (context.imageHashByAssetId.has(assetId)) return context.imageHashByAssetId.get(assetId);

  const asset = context.assetById.get(assetId);
  if (!asset || (!asset.dataUrl && !asset.url)) {
    context.stats.missingAssets += 1;
    context.imageHashByAssetId.set(assetId, null);
    return null;
  }

  if ((asset.width && asset.width > MAX_IMAGE_DIMENSION) || (asset.height && asset.height > MAX_IMAGE_DIMENSION)) {
    context.stats.skippedOversizedImages += 1;
    context.imageHashByAssetId.set(assetId, null);
    return null;
  }

  if (asset.mimeType && !REMOTE_IMAGE_MIME_TYPES.includes(String(asset.mimeType).toLowerCase())) {
    context.stats.unsupportedImages += 1;
    context.imageHashByAssetId.set(assetId, null);
    return null;
  }

  const sharedCacheKey = asset.url ? "url:" + asset.url : null;
  if (sharedCacheKey && context.imageHashByAssetSource.has(sharedCacheKey)) {
    const cachedHash = context.imageHashByAssetSource.get(sharedCacheKey);
    context.imageHashByAssetId.set(assetId, cachedHash);
    return cachedHash;
  }

  try {
    reportProgress(context, "Importing image: " + String(asset.name || asset.id || "asset"), false);
    const image = await createImageForAsset(asset, context);
    if (!image) {
      context.stats.missingAssets += 1;
      context.imageHashByAssetId.set(assetId, null);
      if (sharedCacheKey) context.imageHashByAssetSource.set(sharedCacheKey, null);
      return null;
    }
    context.stats.images += 1;
    context.imageHashByAssetId.set(assetId, image.hash);
    if (sharedCacheKey) context.imageHashByAssetSource.set(sharedCacheKey, image.hash);
    advanceProgress(context, 1, "Imported image: " + String(asset.name || asset.id || "asset"));
    return image.hash;
  } catch (error) {
    if (asset.url && !asset.dataUrl) recordRemoteAssetFailure(context, asset, error);
    else context.stats.unsupportedImages += 1;
    context.imageHashByAssetId.set(assetId, null);
    if (sharedCacheKey) context.imageHashByAssetSource.set(sharedCacheKey, null);
    return null;
  }
}

async function paintsForNode(payloadNode, context) {
  const paints = [];
  const plan = importPlanForNode(payloadNode);
  if (plan && Array.isArray(plan.fills)) {
    for (const paint of plan.fills) {
      if (paint.type === "SOLID") {
        const solid = clonePlanPaint(paint);
        if (solid) paints.push(solid);
      }
      if (paint.type === "IMAGE") {
        const hash = await imageHashForAsset(paint.assetId, context);
        if (hash) {
          const imagePaint = {
            type: "IMAGE",
            imageHash: hash,
            scaleMode: paint.scaleMode || "FILL",
          };
          paints.push(imagePaint);
        }
      }
      if (paint.type === "GRADIENT_LINEAR") {
        const gradient = clonePlanPaint(paint);
        if (gradient) paints.push(gradient);
      }
    }
    return paints;
  }

  const opacity = typeof payloadNode.opacity === "number" ? clamp(payloadNode.opacity, 0, 1) : undefined;

  for (const paint of payloadNode.fills || []) {
      if (paint.type === "SOLID") {
        const solid = solidPaint(paint.color, paint.opacity === undefined ? opacity : paint.opacity);
        if (solid) paints.push(solid);
      }
      if (paint.type === "CSS_GRADIENT") {
        const gradient = gradientPaintFromCss(paint.value);
        if (gradient) paints.push(gradient);
      }
      if (paint.type === "IMAGE") {
        const hash = await imageHashForAsset(paint.assetId, context);
      if (hash) {
        const imagePaint = {
          type: "IMAGE",
          imageHash: hash,
          scaleMode: paint.scaleMode || "FILL",
        };
        paints.push(imagePaint);
      }
    }
  }

  if (payloadNode.imageRef && !paints.some((paint) => paint.type === "IMAGE")) {
    const hash = await imageHashForAsset(payloadNode.imageRef, context);
    if (hash) paints.push({ type: "IMAGE", imageHash: hash, scaleMode: imageScaleModeForPayload(payloadNode) });
  }

  return paints;
}

function applyStrokes(sceneNode, payloadNode) {
  if (!Array.isArray(payloadNode.strokes) || payloadNode.strokes.length === 0 || !("strokes" in sceneNode)) return;
  if (hasBorderSides(payloadNode)) return;
  if (strokeSideFallback(payloadNode)) return;
  const stroke = payloadNode.strokes[0];
  const paint = solidPaint(stroke.color);
  if (!paint) return;
  sceneNode.strokes = [paint];
  if ("strokeWeight" in sceneNode) sceneNode.strokeWeight = Math.max(0, Number(stroke.weight) || 1);
  if ("strokeAlign" in sceneNode && stroke.align) sceneNode.strokeAlign = stroke.align;
}

function splitCssList(value) {
  const result = [];
  let current = "";
  let depth = 0;
  const source = String(value || "");

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (char === "," && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function tokenizeCssValue(value) {
  const result = [];
  let current = "";
  let depth = 0;
  const source = String(value || "").trim();

  for (let index = 0; index < source.length; index += 1) {
    const char = source.charAt(index);
    if (char === "(") depth += 1;
    if (char === ")") depth = Math.max(0, depth - 1);
    if (/\s/.test(char) && depth === 0) {
      if (current.trim()) result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  if (current.trim()) result.push(current.trim());
  return result;
}

function lengthToPx(value) {
  const number = parseFloat(String(value || "0").replace("px", ""));
  return Number.isFinite(number) ? number : 0;
}

function parseShadowEffect(value, fallbackColor, canUseSpread) {
  const raw = String(value || "").trim();
  if (!raw || raw === "none") return null;

  let inset = false;
  let colorValue = fallbackColor || "rgba(0, 0, 0, 0.18)";
  const lengths = [];
  const tokens = tokenizeCssValue(raw);

  for (const token of tokens) {
    const normalized = token.toLowerCase();
    if (normalized === "inset") {
      inset = true;
    } else if (parseCssColor(token)) {
      colorValue = token;
    } else {
      lengths.push(token);
    }
  }

  if (lengths.length < 2) return null;

  const offsetX = lengthToPx(lengths[0]);
  const offsetY = lengthToPx(lengths[1]);
  const blur = Math.max(0, lengthToPx(lengths[2] || "0"));
  const spread = lengthToPx(lengths[3] || "0");
  const color = colorForEffect(colorValue);
  if (color.a <= 0.001) return null;

  const effect = {
    type: inset ? "INNER_SHADOW" : "DROP_SHADOW",
    color: color,
    offset: { x: offsetX, y: offsetY },
    radius: blur,
    visible: true,
    blendMode: "NORMAL",
  };
  if (!inset) effect.showShadowBehindNode = true;
  if (spread !== 0 && canUseSpread) effect.spread = spread;
  return effect;
}

function blurRadiusFromCss(value) {
  const match = String(value || "").match(/blur\(([^)]+)\)/i);
  return match ? Math.max(0, lengthToPx(match[1])) : 0;
}

function hasVisibleFill(payloadNode) {
  const fills = payloadNode.fills || [];
  return fills.some(function (paint) {
    if (paint.type === "IMAGE") return true;
    if (paint.type !== "SOLID") return false;
    const parsed = parseCssColor(paint.color);
    if (!parsed) return false;
    const opacity = paint.opacity === undefined ? parsed.opacity : parsed.opacity * clamp(paint.opacity, 0, 1);
    return opacity > 0.001;
  });
}

function nodeHasVisibleShadow(payloadNode) {
  const plan = importPlanForNode(payloadNode);
  if (plan && Array.isArray(plan.effects)) {
    return plan.effects.some(function (effect) {
      return effect && (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW");
    });
  }
  return (payloadNode.effects || []).some(function (effect) {
    return effect && effect.type === "DROP_SHADOW" && effect.value && effect.value !== "none";
  });
}

function shadowSupportFill() {
  return {
    type: "SOLID",
    color: { r: 1, g: 1, b: 1 },
    opacity: 0.01,
  };
}

function canUseShadowSpread(sceneNode, payloadNode) {
  if (!sceneNode) return false;
  if (sceneNode.type === "RECTANGLE" || sceneNode.type === "ELLIPSE") return true;
  if (["FRAME", "COMPONENT", "INSTANCE"].includes(sceneNode.type)) {
    return "clipsContent" in sceneNode && sceneNode.clipsContent === true && hasVisibleFill(payloadNode);
  }
  return false;
}

function shadowHasNonZeroSpread(value) {
  const raw = String(value || "").trim();
  if (!raw || raw === "none") return false;

  const lengths = [];
  const tokens = tokenizeCssValue(raw);
  for (const token of tokens) {
    if (token.toLowerCase() === "inset") {
      // Not a length.
    } else if (!parseCssColor(token)) {
      lengths.push(token);
    }
  }

  return lengths.length >= 4 && lengthToPx(lengths[3]) !== 0;
}

function hasNonZeroShadowSpread(payloadNode) {
  if (!payloadNode || !Array.isArray(payloadNode.effects)) return false;
  for (const effect of payloadNode.effects) {
    if (!effect || effect.type !== "DROP_SHADOW" || !effect.value) continue;
    const shadows = splitCssList(effect.value);
    for (const shadow of shadows) {
      if (shadowHasNonZeroSpread(shadow)) return true;
    }
  }
  return false;
}

function applyEffects(sceneNode, payloadNode) {
  if (!("effects" in sceneNode)) return;
  const plan = importPlanForNode(payloadNode);
  if (plan && Array.isArray(plan.effects)) {
    const plannedEffects = [];
    for (const effect of plan.effects) {
      const cloned = clonePlanEffect(effect);
      if (cloned) plannedEffects.push(cloned);
    }
    if (plannedEffects.length > 0) sceneNode.effects = plannedEffects.slice(0, 8);
    return;
  }

  if (!Array.isArray(payloadNode.effects) || payloadNode.effects.length === 0) return;
  const effects = [];
  const canUseSpread = canUseShadowSpread(sceneNode, payloadNode);

  for (const effect of payloadNode.effects) {
    if (!effect || !effect.value) continue;
    if (effect.type === "DROP_SHADOW") {
      const shadows = splitCssList(effect.value);
      for (const shadow of shadows) {
        const parsed = parseShadowEffect(shadow, payloadNode.css && payloadNode.css.color, canUseSpread);
        if (parsed) effects.push(parsed);
      }
    }

    if (effect.type === "BACKGROUND_BLUR") {
      const radius = blurRadiusFromCss(effect.value);
      if (radius > 0) {
        effects.push({ type: "BACKGROUND_BLUR", radius: radius, visible: true });
      }
    }

    if (effect.type === "CSS_EFFECT") {
      const radius = blurRadiusFromCss(effect.value);
      if (radius > 0) {
        effects.push({ type: "LAYER_BLUR", radius: radius, visible: true });
      }
    }
  }

  if (effects.length > 0) sceneNode.effects = effects.slice(0, 8);
}

function visibleBorderSide(side) {
  if (!side || !(Number(side.width) > 0)) return null;
  const parsed = parseCssColor(side.color);
  if (!parsed || parsed.opacity <= 0.001) return null;
  return { color: side.color, width: Number(side.width) };
}

function isDetailsSeparatorNode(payloadNode) {
  const name = String(payloadNode && payloadNode.name || "").toLowerCase();
  if (name.indexOf("details") >= 0) return true;
  const children = payloadNode && payloadNode.children ? payloadNode.children : [];
  return children.some(function (child) {
    return String(child && child.name || "").toLowerCase().indexOf("summary") >= 0;
  });
}

function hasRoundedCorners(payloadNode) {
  if (!payloadNode) return false;
  if (Number(payloadNode.cornerRadius) > 0) return true;
  if (Array.isArray(payloadNode.cornerRadii) && payloadNode.cornerRadii.some(function (value) {
    return Number(value) > 0;
  })) return true;

  const css = payloadNode.css || {};
  return (
    lengthToPx(css.borderTopLeftRadius) > 0 ||
    lengthToPx(css.borderTopRightRadius) > 0 ||
    lengthToPx(css.borderBottomRightRadius) > 0 ||
    lengthToPx(css.borderBottomLeftRadius) > 0
  );
}

function hasVisibleNodeFill(payloadNode) {
  if (!payloadNode) return false;
  if (hasVisibleFill(payloadNode)) return true;
  const css = payloadNode.css || {};
  const parsed = parseCssColor(css.backgroundColor);
  return !!(parsed && parsed.opacity > 0.001);
}

function isFlatSeparatorNode(payloadNode) {
  if (!payloadNode) return false;
  if (isDetailsSeparatorNode(payloadNode)) return true;
  if (hasRoundedCorners(payloadNode) || hasVisibleNodeFill(payloadNode)) return false;

  const width = safeSize(payloadNode.width);
  const height = safeSize(payloadNode.height);
  return width >= 32 && height >= 1;
}

function strokeSideFallback(payloadNode) {
  if (!payloadNode || !Array.isArray(payloadNode.strokes) || payloadNode.strokes.length === 0) return false;
  if (!isFlatSeparatorNode(payloadNode)) return null;

  const stroke = payloadNode.strokes[0];
  const fallbackSide = visibleBorderSide({ color: stroke.color, width: Number(stroke.weight) || 1 });
  if (!fallbackSide) return null;

  const css = payloadNode.css || {};
  const candidates = [
    ["top", css.borderTopWidth],
    ["right", css.borderRightWidth],
    ["bottom", css.borderBottomWidth],
    ["left", css.borderLeftWidth],
  ].filter(function (candidate) {
    return candidate[1] !== undefined && lengthToPx(candidate[1]) > 0;
  });

  if (candidates.length > 0 && candidates.length < 4) {
    const result = {};
    candidates.forEach(function (candidate) {
      result[candidate[0]] = fallbackSide;
    });
    return result;
  }

  if (isDetailsSeparatorNode(payloadNode)) {
    return { bottom: fallbackSide };
  }

  return null;
}

function borderSidesFromPayload(payloadNode) {
  const plan = importPlanForNode(payloadNode);
  if (plan && Object.prototype.hasOwnProperty.call(plan, "borders")) {
    return plan.borders || null;
  }

  const result = {};
  const source = payloadNode && payloadNode.borders ? payloadNode.borders : null;
  if (source) {
    ["top", "right", "bottom", "left"].forEach(function (sideName) {
      const side = visibleBorderSide(source[sideName]);
      if (side) result[sideName] = side;
    });
  } else if (payloadNode && payloadNode.css) {
    const css = payloadNode.css;
    const hasCompleteBorderCss =
      css.borderTopWidth !== undefined &&
      css.borderRightWidth !== undefined &&
      css.borderBottomWidth !== undefined &&
      css.borderLeftWidth !== undefined &&
      css.borderTopColor !== undefined &&
      css.borderRightColor !== undefined &&
      css.borderBottomColor !== undefined &&
      css.borderLeftColor !== undefined;

    if (hasCompleteBorderCss) {
      const cssSides = {
        top: { color: css.borderTopColor, width: lengthToPx(css.borderTopWidth) },
        right: { color: css.borderRightColor, width: lengthToPx(css.borderRightWidth) },
        bottom: { color: css.borderBottomColor, width: lengthToPx(css.borderBottomWidth) },
        left: { color: css.borderLeftColor, width: lengthToPx(css.borderLeftWidth) },
      };
      ["top", "right", "bottom", "left"].forEach(function (sideName) {
        const side = visibleBorderSide(cssSides[sideName]);
        if (side) result[sideName] = side;
      });
    }
  }

  if (Object.keys(result).length === 0) {
    const fallback = strokeSideFallback(payloadNode);
    if (fallback) {
      ["top", "right", "bottom", "left"].forEach(function (sideName) {
        if (fallback[sideName]) result[sideName] = fallback[sideName];
      });
    }
  }

  const sides = ["top", "right", "bottom", "left"].filter(function (sideName) {
    return !!result[sideName];
  });
  if (sides.length === 0) return null;
  if (sides.length === 4 && Array.isArray(payloadNode.strokes) && payloadNode.strokes.length > 0) {
    const first = result[sides[0]];
    const uniform = sides.every(function (sideName) {
      const side = result[sideName];
      return side.width === first.width && side.color === first.color;
    });
    if (uniform) return null;
  }

  return result;
}

function borderSide(payloadNode, side) {
  const borders = borderSidesFromPayload(payloadNode);
  return borders ? borders[side] || null : null;
}

function hasBorderSides(payloadNode) {
  return !!(
    borderSide(payloadNode, "top") ||
    borderSide(payloadNode, "right") ||
    borderSide(payloadNode, "bottom") ||
    borderSide(payloadNode, "left")
  );
}

function parentUsesAutoLayout(parentNode) {
  return !!(
    parentNode &&
    "layoutMode" in parentNode &&
    parentNode.layoutMode &&
    parentNode.layoutMode !== "NONE"
  );
}

function appendOneBorder(frameNode, name, side, x, y, width, height) {
  const paint = side && side.paint ? clonePlanPaint(side.paint) : solidPaint(side && side.color);
  if (!paint) return;
  const node = figma.createRectangle();
  node.name = name;
  node.x = roundPixel(x);
  node.y = roundPixel(y);
  node.resizeWithoutConstraints(Math.max(0.01, roundPixel(width)), Math.max(0.01, roundPixel(height)));
  node.fills = [paint];
  node.strokes = [];
  frameNode.appendChild(node);
  if ("layoutPositioning" in node && parentUsesAutoLayout(frameNode)) {
    node.layoutPositioning = "ABSOLUTE";
  }
}

function appendBorderSides(frameNode, payloadNode) {
  if (!parentCanAcceptChildren(frameNode) || !hasBorderSides(payloadNode)) return;
  const width = safeSize(payloadNode.width);
  const height = safeSize(payloadNode.height);
  const top = borderSide(payloadNode, "top");
  const right = borderSide(payloadNode, "right");
  const bottom = borderSide(payloadNode, "bottom");
  const left = borderSide(payloadNode, "left");

  if (top) appendOneBorder(frameNode, "Border top", top, 0, 0, width, top.width);
  if (right) appendOneBorder(frameNode, "Border right", right, width - right.width, 0, right.width, height);
  if (bottom) appendOneBorder(frameNode, "Border bottom", bottom, 0, height - bottom.width, width, bottom.width);
  if (left) appendOneBorder(frameNode, "Border left", left, 0, 0, left.width, height);
}

function shouldCreateContentClipFrame(payloadNode, sceneNode) {
  const plan = importPlanForNode(payloadNode);
  if (plan && plan.clip && typeof plan.clip.useContentClipFrame === "boolean") {
    return !!(
      plan.clip.useContentClipFrame &&
      parentCanAcceptChildren(sceneNode) &&
      Array.isArray(payloadNode.children) &&
      payloadNode.children.length > 0
    );
  }
  return !!(
    nodeShouldClip(payloadNode) &&
    parentCanAcceptChildren(sceneNode) &&
    Array.isArray(payloadNode.children) &&
    payloadNode.children.length > 0
  );
}

function createContentClipFrame(payloadNode) {
  const clipFrame = figma.createFrame();
  clipFrame.name = "Content clip";
  clipFrame.x = 0;
  clipFrame.y = 0;
  clipFrame.resizeWithoutConstraints(safeSize(payloadNode.width), safeSize(payloadNode.height));
  clipFrame.fills = [];
  clipFrame.strokes = [];
  clipFrame.clipsContent = true;
  applyCornerRadii(clipFrame, payloadNode);
  return clipFrame;
}

function appendContentMask(clipFrame, payloadNode) {
  const mask = figma.createRectangle();
  mask.name = "Overflow mask";
  mask.x = 0;
  mask.y = 0;
  mask.resizeWithoutConstraints(safeSize(payloadNode.width), safeSize(payloadNode.height));
  mask.fills = [{ type: "SOLID", color: { r: 1, g: 1, b: 1 }, opacity: 1 }];
  mask.strokes = [];
  applyCornerRadii(mask, payloadNode);
  mask.isMask = true;
  if ("maskType" in mask) mask.maskType = "ALPHA";
  clipFrame.appendChild(mask);
}

function isOverflowMaskNode(node) {
  return !!(node && node.name === "Overflow mask" && "isMask" in node && node.isMask === true);
}

function hasMaskGroup(clipFrame) {
  if (!clipFrame || !clipFrame.children || clipFrame.children.length !== 1) return false;
  const child = clipFrame.children[0];
  if (!child || child.name !== "Masked content" || !child.children) return false;
  return child.children.some(isOverflowMaskNode);
}

function disableBlockingClipOnMaskSiblings(nodes) {
  for (const node of nodes) {
    if (isOverflowMaskNode(node)) continue;
    if ("clipsContent" in node) node.clipsContent = false;
  }
}

function sealContentClipFrame(clipFrame, payloadNode, context) {
  if (!clipFrame || !clipFrame.children || clipFrame.children.length <= 1) return;
  if (hasMaskGroup(clipFrame)) return;

  const children = clipFrame.children.slice();
  const hasMask = children.some(isOverflowMaskNode);
  if (!hasMask) {
    appendContentMask(clipFrame, payloadNode);
  }

  const groupChildren = clipFrame.children.slice();
  if (groupChildren.length <= 1) return;

  try {
    disableBlockingClipOnMaskSiblings(groupChildren);
    const group = figma.group(groupChildren, clipFrame);
    group.name = "Masked content";
    if ("clipsContent" in group) group.clipsContent = false;
    if ("clipsContent" in clipFrame) clipFrame.clipsContent = false;
    const mask = group.children.find(isOverflowMaskNode);
    if (mask) mask.locked = true;
    context.stats.maskGroups += 1;
    context.stats.nodes += 1;
  } catch (error) {
    if ("clipsContent" in clipFrame) clipFrame.clipsContent = true;
    context.stats.maskGroupFailures += 1;
  }
}

function contentTargetForNode(node, context) {
  return context.contentTargetByNode.get(node) || node;
}

function visualNodeForPostProcess(node, context) {
  return context.visualNodeByContentTarget.get(node) || node;
}

async function createTextNode(payloadNode, context) {
  const style = payloadNode.textStyle || {};
  const rawCharacters = String(payloadNode.characters || "");
  const characters = normalizedTextCharacters(payloadNode);
  const fontStyle = shouldUseFallbackFontForNormalizedIcon(rawCharacters, characters, style.fontFamily)
    ? Object.assign({}, style, { fontFamily: DEFAULT_FONT.family, fontWeight: 400, fontStyle: "normal" })
    : style;
  const fontName = await loadBestFont(fontStyle);
  const node = figma.createText();
  node.fontName = fontName;
  node.textAutoResize = "NONE";
  applyCommonProperties(node, payloadNode);

  if (style.fontSize) node.fontSize = clamp(style.fontSize, 1, 400);
  if (style.lineHeight) node.lineHeight = { unit: "PIXELS", value: clamp(style.lineHeight, 1, 1000) };
  if (typeof style.letterSpacing === "number") node.letterSpacing = { unit: "PIXELS", value: style.letterSpacing };

  const align = String(style.textAlign || "").toLowerCase();
  if (align === "center") node.textAlignHorizontal = "CENTER";
  if (align === "right" || align === "end") node.textAlignHorizontal = "RIGHT";
  if (align === "justify") node.textAlignHorizontal = "JUSTIFIED";

  const plan = importPlanForNode(payloadNode);
  const textPlan = plan && plan.text ? plan.text : null;
  const decoration = textPlan && textPlan.decoration
    ? String(textPlan.decoration).toUpperCase()
    : String(style.textDecoration || style.textDecorationLine || "").toLowerCase();
  if ("textDecoration" in node) {
    if (decoration === "STRIKETHROUGH" || decoration.indexOf("line-through") !== -1 || decoration.indexOf("strikethrough") !== -1) {
      node.textDecoration = "STRIKETHROUGH";
    } else if (decoration === "UNDERLINE" || decoration.indexOf("underline") !== -1) {
      node.textDecoration = "UNDERLINE";
    } else {
      node.textDecoration = "NONE";
    }
  }

  const fills = await paintsForNode(payloadNode, context);
  if (fills.length) node.fills = fills;

  node.characters = characters;
  fitSingleLineTextToBrowserWidth(node, payloadNode, characters);

  if (shouldPreserveMeasuredTextBox(payloadNode)) {
    node.resizeWithoutConstraints(safeSize(payloadNode.width), safeSize(payloadNode.height));
    node.textAutoResize = "NONE";
    return node;
  }

  if (textPlan && textPlan.preserveWidth) {
    node.resizeWithoutConstraints(
      Math.max(safeSize(textPlan.width || payloadNode.width), 1),
      Math.max(safeSize(textPlan.height || payloadNode.height), 1)
    );
    node.textAutoResize = "HEIGHT";
    return node;
  }

  if (textPlan && textPlan.resizeMode === "WIDTH_AND_HEIGHT") {
    node.textAutoResize = "WIDTH_AND_HEIGHT";
    return node;
  }

  if (textPlan && textPlan.resizeMode === "HEIGHT") {
    const resizeWidth = heightTextResizeWidth(node, payloadNode, textPlan, characters);
    node.resizeWithoutConstraints(
      resizeWidth,
      Math.max(safeSize(textPlan.height || payloadNode.height), 1)
    );
    node.textAutoResize = "HEIGHT";
    return node;
  }

  const lineHeight =
    typeof style.lineHeight === "number" && style.lineHeight > 0
      ? style.lineHeight
      : typeof style.fontSize === "number" && style.fontSize > 0
        ? style.fontSize * 1.2
        : 18;
  const looksSingleLine =
    safeSize(payloadNode.height) <= lineHeight * 1.45 ||
    characters.length <= 28 ||
    !/\s/.test(characters);

  if (looksSingleLine) {
    node.textAutoResize = "WIDTH_AND_HEIGHT";
  } else {
    const measuredMultiline = safeSize(payloadNode.height) > lineHeight * 1.45;
    const bufferedWidth = measuredMultiline
      ? Math.ceil(safeSize(payloadNode.width) + 2)
      : Math.ceil(safeSize(payloadNode.width) * MULTI_LINE_WIDTH_FACTOR + MULTI_LINE_MIN_PADDING);
    node.resizeWithoutConstraints(bufferedWidth, Math.max(safeSize(payloadNode.height), lineHeight));
    node.textAutoResize = "HEIGHT";
  }

  return node;
}

function lineHeightForTextPayload(payloadNode) {
  const style = payloadNode && payloadNode.textStyle ? payloadNode.textStyle : {};
  if (typeof style.lineHeight === "number" && style.lineHeight > 0) return style.lineHeight;
  if (typeof style.fontSize === "number" && style.fontSize > 0) return style.fontSize * 1.2;
  return safeSize(payloadNode && payloadNode.height ? payloadNode.height : 18);
}

function clonePayload(payloadNode, overrides) {
  const clone = {};
  for (const key in payloadNode || {}) {
    clone[key] = payloadNode[key];
  }
  for (const key in overrides || {}) {
    clone[key] = overrides[key];
  }
  return clone;
}

function payloadTextIsMeasuredMultiline(payloadNode) {
  if (!payloadNode || payloadNode.type !== "TEXT") return false;
  const characters = String(payloadNode.characters || "").trim();
  if (!characters || characters.indexOf(" ") < 0) return false;
  const lineHeight = lineHeightForTextPayload(payloadNode);
  return safeSize(payloadNode.height) > lineHeight * 1.45;
}

async function measureTextWidth(characters, style) {
  const text = figma.createText();
  text.visible = false;
  text.fontName = await loadBestFont(style || {});
  text.textAutoResize = "WIDTH_AND_HEIGHT";
  if (style && style.fontSize) text.fontSize = clamp(style.fontSize, 1, 400);
  if (style && style.lineHeight) text.lineHeight = { unit: "PIXELS", value: clamp(style.lineHeight, 1, 1000) };
  if (style && typeof style.letterSpacing === "number") {
    text.letterSpacing = { unit: "PIXELS", value: style.letterSpacing };
  }
  text.characters = String(characters || "");
  const width = safeSize(text.width);
  text.remove();
  return width;
}

async function measureSceneTextWidth(characters, sourceNode) {
  const text = figma.createText();
  text.visible = false;
  const sourceFont = sourceNode && sourceNode.fontName && typeof sourceNode.fontName === "object"
    ? sourceNode.fontName
    : DEFAULT_FONT;
  try {
    await figma.loadFontAsync(sourceFont);
    text.fontName = sourceFont;
  } catch (error) {
    await ensureDefaultFont();
    text.fontName = DEFAULT_FONT;
  }
  text.textAutoResize = "WIDTH_AND_HEIGHT";
  if (sourceNode && typeof sourceNode.fontSize === "number") {
    text.fontSize = clamp(sourceNode.fontSize, 1, 400);
  }
  if (sourceNode && sourceNode.lineHeight && typeof sourceNode.lineHeight === "object" && sourceNode.lineHeight.unit === "PIXELS") {
    text.lineHeight = { unit: "PIXELS", value: clamp(sourceNode.lineHeight.value, 1, 1000) };
  }
  if (sourceNode && sourceNode.letterSpacing && typeof sourceNode.letterSpacing === "object" && sourceNode.letterSpacing.unit === "PIXELS") {
    text.letterSpacing = { unit: "PIXELS", value: sourceNode.letterSpacing.value };
  }
  text.characters = String(characters || "");
  const width = safeSize(text.width);
  text.remove();
  return width;
}

async function splitTextToFitWidth(characters, style, width) {
  const source = String(characters || "").replace(/\s+/g, " ").trim();
  if (!source) return ["", ""];

  const tokens = source.split(/(\s+)/).filter(function (token) {
    return token.length > 0;
  });
  let best = "";
  let bestIndex = 0;
  let candidate = "";

  for (let index = 0; index < tokens.length; index += 1) {
    candidate += tokens[index];
    const trimmed = candidate.trim();
    if (!trimmed) continue;
    const measuredWidth = await measureTextWidth(trimmed, style);
    if (measuredWidth <= width + 1 || !best) {
      best = trimmed;
      bestIndex = index + 1;
    } else {
      break;
    }
  }

  const rest = tokens.slice(bestIndex).join("").trim();
  if (!best || !rest || best === source) return [source, ""];
  return [best, rest];
}

function siblingOverlapsLine(sibling, lineY, lineHeight) {
  if (!sibling) return false;
  const siblingY = Number(sibling.y) || 0;
  const siblingHeight = safeSize(sibling.height || lineHeight);
  return siblingY < lineY + lineHeight * 0.9 && siblingY + siblingHeight > lineY - lineHeight * 0.3;
}

function occupiedFirstLineRight(payloadNode, childNode, textNode, siblings) {
  const lineHeight = lineHeightForTextPayload(textNode);
  const childX = Number(childNode.x) || 0;
  const lineY = childNode === textNode
    ? Number(textNode.y) || 0
    : (Number(childNode.y) || 0) + (Number(textNode.y) || 0);
  let right = 0;

  for (const sibling of siblings || []) {
    if (!sibling || sibling === childNode) continue;
    if (!siblingOverlapsLine(sibling, lineY, lineHeight)) continue;
    const siblingX = Number(sibling.x) || 0;
    const siblingRight = siblingX + safeSize(sibling.width);
    if (siblingRight > right) right = siblingRight;
  }

  return right;
}

async function repairMultilineTextNode(textNode, wrapperNode, siblings, parentNode) {
  if (!payloadTextIsMeasuredMultiline(textNode)) return null;
  const lineHeight = lineHeightForTextPayload(textNode);
  const wrapperX = Number(wrapperNode.x) || 0;
  const textX = Number(textNode.x) || 0;
  const right = occupiedFirstLineRight(parentNode, wrapperNode, textNode, siblings);
  const fontSize = textNode && textNode.textStyle && typeof textNode.textStyle.fontSize === "number"
    ? textNode.textStyle.fontSize
    : lineHeight / 1.2;
  const wordGap = right > 0 ? Math.max(2, Math.min(10, fontSize * 0.28)) : 0;
  const firstX = Math.max(0, right - wrapperX + wordGap);
  const parentWidth = safeSize(parentNode && parentNode.width ? parentNode.width : wrapperNode.width);
  const availableWidth = Math.max(1, parentWidth - right - wordGap);

  if (firstX <= textX + 2 || availableWidth < 24) return null;

  const split = await splitTextToFitWidth(textNode.characters, textNode.textStyle || {}, availableWidth);
  if (!split[0] || !split[1]) return null;

  const lineBoxHeight = Math.max(lineHeight, Math.min(safeSize(textNode.height), lineHeight * 1.12));
  const firstWidth = await measureTextWidth(split[0], textNode.textStyle || {});
  const secondWidth = await measureTextWidth(split[1], textNode.textStyle || {});
  const firstLine = clonePayload(textNode, {
    id: String(textNode.id || textNode.name || "text") + "_line_1",
    name: split[0].slice(0, 48) || "Text",
    characters: split[0],
    x: firstX,
    y: Number(textNode.y) || 0,
    width: firstWidth,
    height: lineBoxHeight,
  });
  const secondLine = clonePayload(textNode, {
    id: String(textNode.id || textNode.name || "text") + "_line_2",
    name: split[1].slice(0, 48) || "Text",
    characters: split[1],
    x: 0,
    y: (Number(textNode.y) || 0) + lineHeight,
    width: secondWidth,
    height: lineBoxHeight,
  });

  return [firstLine, secondLine];
}

async function repairedChildrenForPayload(payloadNode) {
  const children = payloadNode && Array.isArray(payloadNode.children) ? payloadNode.children : [];
  if (children.length < 2) return children;

  const repaired = [];
  for (const child of children) {
    const display = String(child && child.css && child.css.display ? child.css.display : "").toLowerCase();
    const isInlineWrapper = display === "inline" &&
      child &&
      Array.isArray(child.children) &&
      child.children.length === 1 &&
      child.children[0] &&
      child.children[0].type === "TEXT";

    if (isInlineWrapper) {
      const textNode = child.children[0];
      const repairedText = await repairMultilineTextNode(textNode, child, children, payloadNode);
      if (repairedText) {
        repaired.push(clonePayload(child, {
          children: repairedText,
          name: String(textNode.characters || child.name || "Text").slice(0, 64),
        }));
        continue;
      }
    }

    if (child && child.type === "TEXT") {
      const repairedText = await repairMultilineTextNode(child, child, children, payloadNode);
      if (repairedText) {
        for (const repairedChild of repairedText) repaired.push(repairedChild);
        continue;
      }
    }

    repaired.push(child);
  }

  return repaired;
}

function payloadInlineTextContent(payloadNode) {
  if (!payloadNode) return "";
  if (payloadNode.type === "TEXT") return String(payloadNode.characters || "");
  const css = payloadNode.css || {};
  const display = String(css.display || "").toLowerCase();
  if (display && display.indexOf("inline") !== 0) return "";
  let text = "";
  for (const child of payloadNode.children || []) {
    text += payloadInlineTextContent(child);
  }
  return text;
}

function payloadHasDirectInlineWhitespaceBoundary(payloadNode) {
  const children = payloadNode && Array.isArray(payloadNode.children) ? payloadNode.children : [];
  if (children.length < 2) return false;
  let hasBoundarySpace = false;
  let textChildCount = 0;
  for (const child of children) {
    const text = payloadInlineTextContent(child);
    if (!text.trim()) continue;
    textChildCount += 1;
    if (/\s$/.test(text)) hasBoundarySpace = true;
  }
  return hasBoundarySpace && textChildCount >= 2;
}

function collectInlineTextSegmentsFromNode(node, root, baseX, baseY, segments) {
  if (!node || node.visible === false) return;
  const x = baseX + (Number(node.x) || 0);
  const y = baseY + (Number(node.y) || 0);
  if (node.type === "TEXT") {
    const characters = String(node.characters || "");
    if (characters.trim()) {
      segments.push({
        node: node,
        root: root,
        x: x,
        y: y,
        width: safeSize(node.width),
        height: safeSize(node.height),
        characters: characters,
      });
    }
    return;
  }
  if (!("children" in node) || !node.children) return;
  for (const child of node.children) {
    collectInlineTextSegmentsFromNode(child, root, x, y, segments);
  }
}

function collectInlineTextSegments(parent) {
  const segments = [];
  if (!parent || !parent.children) return segments;
  for (const child of parent.children) {
    collectInlineTextSegmentsFromNode(child, child, 0, 0, segments);
  }
  return segments;
}

function inlineSegmentsSameLine(left, right) {
  if (!left || !right) return false;
  const top = Math.max(left.y, right.y);
  const bottom = Math.min(left.y + left.height, right.y + right.height);
  const overlap = bottom - top;
  const minHeight = Math.min(left.height, right.height);
  const leftCenter = left.y + left.height / 2;
  const rightCenter = right.y + right.height / 2;
  return overlap >= minHeight * 0.42 || Math.abs(leftCenter - rightCenter) <= Math.max(3, minHeight * 0.32);
}

function shiftTargetForInlineSegment(segment) {
  if (!segment || !segment.node) return null;
  if (segment.node === segment.root) return segment.node;
  const localX = Number(segment.node.x) || 0;
  if (Math.abs(localX) <= 0.5) return segment.root;
  return segment.node;
}

function resizeInlineRootToContain(segment) {
  if (!segment || !segment.root || segment.node === segment.root) return;
  if (!("resizeWithoutConstraints" in segment.root)) return;
  if ("layoutMode" in segment.root && segment.root.layoutMode !== "NONE") return;
  const localRight = (Number(segment.node.x) || 0) + safeSize(segment.node.width);
  if (localRight <= safeSize(segment.root.width) + 0.5) return;
  segment.root.resizeWithoutConstraints(roundPixel(localRight), safeSize(segment.root.height));
}

function shiftInlineSegment(segment, delta, shiftedTargets) {
  const target = shiftTargetForInlineSegment(segment);
  if (!target || shiftedTargets.indexOf(target) !== -1) return;
  target.x = roundPixel((Number(target.x) || 0) + delta);
  shiftedTargets.push(target);
  resizeInlineRootToContain(segment);
}

async function inlineSpaceMetrics(segment) {
  const characters = String(segment.characters || "");
  if (!/\s$/.test(characters)) return null;
  const trimmed = characters.replace(/\s+$/g, "");
  if (!trimmed) return null;
  const trimmedWidth = await measureSceneTextWidth(trimmed, segment.node);
  const fullWidth = await measureSceneTextWidth(characters, segment.node);
  const fontSize = typeof segment.node.fontSize === "number" ? segment.node.fontSize : 16;
  const fallbackSpace = Math.max(2, Math.min(18, fontSize * 0.22));
  const measuredSpace = Math.max(0, fullWidth - trimmedWidth);
  return {
    visibleRight: segment.x + trimmedWidth,
    spaceWidth: Math.max(fallbackSpace, measuredSpace),
  };
}

async function repairInlineBoundarySpacing(parent, payloadNode) {
  if (!payloadHasDirectInlineWhitespaceBoundary(payloadNode)) return false;
  if (!parent || !parent.children || parent.children.length < 2) return false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const segments = collectInlineTextSegments(parent).sort(function (left, right) {
      const yDelta = left.y - right.y;
      if (Math.abs(yDelta) > 2) return yDelta;
      return left.x - right.x;
    });
    let changed = false;

    for (const segment of segments) {
      if (!/\s$/.test(String(segment.characters || ""))) continue;
      const metrics = await inlineSpaceMetrics(segment);
      if (!metrics) continue;
      let next = null;
      for (const candidate of segments) {
        if (candidate === segment) continue;
        if (candidate.x <= segment.x + 1) continue;
        if (!inlineSegmentsSameLine(segment, candidate)) continue;
        if (!next || candidate.x < next.x) next = candidate;
      }
      if (!next) continue;

      const desiredLeft = metrics.visibleRight + metrics.spaceWidth;
      if (next.x >= desiredLeft - 0.5) continue;

      const delta = roundPixel(desiredLeft - next.x);
      const shiftedTargets = [];
      for (const candidate of segments) {
        if (candidate.x < next.x - 0.5) continue;
        if (!inlineSegmentsSameLine(next, candidate)) continue;
        shiftInlineSegment(candidate, delta, shiftedTargets);
      }
      changed = shiftedTargets.length > 0;
      if (changed) break;
    }

    if (!changed) return attempt > 0;
  }

  return true;
}

async function createSvgNode(payloadNode, context) {
  if (!payloadNode.svg) return null;
  try {
    const plan = importPlanForNode(payloadNode);
    const vectorPlan = plan && plan.vector ? plan.vector : null;
    const svg = vectorPlan && vectorPlan.svg
      ? String(vectorPlan.svg)
      : normalizeSvgMarkupForFigma(
          payloadNode.svg,
          payloadNode.css && payloadNode.css.color,
          payloadNode.width,
          payloadNode.height,
          payloadNode.rotation
        );
    const node = figma.createNodeFromSvg(svg);
    const commonPayload = {};
    for (const key in payloadNode) {
      commonPayload[key] = payloadNode[key];
    }
    if ((vectorPlan && vectorPlan.rotationBaked) || Math.abs(Number(payloadNode.rotation) || 0) >= 0.01) {
      commonPayload.rotation = undefined;
    }
    applyCommonProperties(node, commonPayload);
    context.stats.vectors += 1;
    return node;
  } catch (error) {
    context.stats.unsupportedVectors += 1;
    return null;
  }
}

async function createSceneNode(payloadNode, context) {
  if (!payloadNode || payloadNode.type === "DOCUMENT" || payloadNode.type === "PAGE") return null;

  if (payloadNode.type === "TEXT") return createTextNode(payloadNode, context);
  if (payloadNode.type === "VECTOR") {
    const vector = await createSvgNode(payloadNode, context);
    if (vector) return vector;
  }

  const shouldUseImageRectangle =
    payloadNode.type === "IMAGE" ||
    payloadNode.imageRef ||
    (payloadNode.fills || []).some((paint) => paint.type === "IMAGE");
  const needsFrameForSideBorders = hasBorderSides(payloadNode);

  const node = payloadNode.type === "FRAME" || payloadNode.type === "GROUP" || needsFrameForSideBorders
    ? figma.createFrame()
    : figma.createRectangle();

  applyCommonProperties(node, payloadNode);
  const fills = await paintsForNode(payloadNode, context);
  if ("fills" in node) node.fills = fills.length || !nodeHasVisibleShadow(payloadNode) ? fills : [shadowSupportFill()];
  applyStrokes(node, payloadNode);
  const hasContentClip = shouldCreateContentClipFrame(payloadNode, node);
  applyClipBehavior(node, payloadNode, hasContentClip);
  applyEffects(node, payloadNode);

  if (hasContentClip) {
    const contentClip = createContentClipFrame(payloadNode);
    appendContentMask(contentClip, payloadNode);
    node.appendChild(contentClip);
    context.contentTargetByNode.set(node, contentClip);
    context.visualNodeByContentTarget.set(contentClip, node);
    context.stats.clipFrames += 1;
    context.stats.clipMasks += 1;
    if (clipReasonForNode(payloadNode) === "geometry") {
      context.stats.inferredClips += 1;
    }
    context.stats.nodes += 2;
  }

  if (shouldUseImageRectangle && !fills.some((paint) => paint.type === "IMAGE")) {
    context.stats.missingImageFills += 1;
  }

  context.stats.nodes += 1;
  advanceProgress(context, 1, "Creating layer: " + String(payloadNode.name || payloadNode.type || "layer"));
  return node;
}

async function appendPayloadChildren(payloadNode, parent, context) {
  const children = await repairedChildrenForPayload(payloadNode);
  for (const child of children) {
    const sceneNode = await createSceneNode(child, context);
    if (sceneNode) {
      parent.appendChild(sceneNode);
      const childParent = contentTargetForNode(sceneNode, context);
      if (parentCanAcceptChildren(childParent)) {
        await appendPayloadChildren(child, childParent, context);
      }
    } else {
      await appendPayloadChildren(child, parent, context);
    }
  }

  if (parentCanAcceptChildren(parent) && parent.type !== "PAGE") {
    const visualParent = visualNodeForPostProcess(parent, context);
    appendBorderSides(visualParent, payloadNode);
    if (visualParent !== parent) {
      parent.clipsContent = true;
      sealContentClipFrame(parent, payloadNode, context);
      applyClipBehavior(visualParent, payloadNode, true);
    } else {
      await repairInlineBoundarySpacing(parent, payloadNode);
      centerInlineControlChildrenVertically(parent, payloadNode);
      centerSingleTextChildIfSafe(parent, payloadNode);
      applyAutoLayoutIfSafe(parent, payloadNode);
      applyClipBehavior(parent, payloadNode, false);
    }
  }
}

function countPayloadNodes(payloadNode) {
  if (!payloadNode || typeof payloadNode !== "object") return 0;
  let count = payloadNode.type === "DOCUMENT" || payloadNode.type === "PAGE" ? 0 : 1;
  const children = Array.isArray(payloadNode.children) ? payloadNode.children : [];
  for (const child of children) {
    count += countPayloadNodes(child);
  }
  return count;
}

async function importPayload(rawPayload) {
  const payload = normalizePayload(rawPayload);
  figma.ui.postMessage({ type: "import-progress", percent: 1, message: "Loading current Figma page..." });
  await figma.currentPage.loadAsync();

  const assetCount = Array.isArray(payload.assets) ? payload.assets.length : 0;
  const nodeCount = countPayloadNodes(payload.document);
  const context = {
    assetById: new Map((payload.assets || []).map((asset) => [asset.id, asset])),
    imageHashByAssetId: new Map(),
    imageHashByAssetSource: new Map(),
    contentTargetByNode: new Map(),
    visualNodeByContentTarget: new Map(),
    progress: {
      completed: 1,
      total: Math.max(1, nodeCount + assetCount),
      lastPercent: 1,
      lastAt: 0,
    },
    stats: {
      nodes: 0,
      images: 0,
      vectors: 0,
      remoteAssetFetches: 0,
      remoteAssetAsyncFallbacks: 0,
      remoteAssetFailures: 0,
      remoteAssetFailureDetails: [],
      missingAssets: 0,
      missingImageFills: 0,
      skippedOversizedImages: 0,
      unsupportedImages: 0,
      unsupportedVectors: 0,
      clipFrames: 0,
      clipMasks: 0,
      inferredClips: 0,
      maskGroups: 0,
      maskGroupFailures: 0,
    },
  };

  const before = figma.currentPage.children.length;
  reportProgress(context, "Creating Figma layers...", true);
  await appendPayloadChildren(payload.document, figma.currentPage, context);
  const created = figma.currentPage.children.slice(before);
  if (created.length === 0) throw new Error("No importable Figma nodes were found in this payload.");

  figma.ui.postMessage({ type: "import-progress", percent: 99, message: "Selecting imported layers..." });
  figma.currentPage.selection = created;
  figma.viewport.scrollAndZoomIntoView(created);

  const skipped =
    context.stats.missingAssets +
    context.stats.missingImageFills +
    context.stats.skippedOversizedImages +
    context.stats.unsupportedImages +
    context.stats.remoteAssetFailures +
    context.stats.unsupportedVectors;
  const skippedText = skipped > 0 ? ` ${skipped} image/vector fills need review.` : "";
  const inferredText = context.stats.inferredClips > 0 ? `, ${context.stats.inferredClips} inferred` : "";
  const clippingText = context.stats.clipFrames > 0
    ? ` Applied ${context.stats.maskGroups}/${context.stats.clipFrames} overflow masks${inferredText}.`
    : "";
  const maskFailureText = context.stats.maskGroupFailures > 0
    ? ` ${context.stats.maskGroupFailures} masks fell back to frame clipping.`
    : "";
  const remoteFailureText = context.stats.remoteAssetFailureDetails.length > 0
    ? " First remote issue: " + context.stats.remoteAssetFailureDetails[0]
    : "";
  return `Imported ${created.length} root layer${created.length === 1 ? "" : "s"} with ${context.stats.nodes} nodes and ${context.stats.images} images. Plugin v${PLUGIN_VERSION} (${PLUGIN_BUILD}).${clippingText}${maskFailureText}${skippedText}${remoteFailureText}`;
}

figma.ui.onmessage = async (message) => {
  if (!message || message.type !== "import-payload") return;
  try {
    const summary = await importPayload(message.payload);
    figma.ui.postMessage({ type: "import-progress", percent: 100, message: "Import complete." });
    figma.ui.postMessage({ type: "import-complete", summary });
    figma.notify(summary);
  } catch (error) {
    const messageText = error && error.message ? error.message : "Import failed.";
    figma.ui.postMessage({ type: "import-error", message: messageText });
    figma.notify(messageText, { error: true });
  }
};
