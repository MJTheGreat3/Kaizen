/**
 * Hand-drawn SVG trees. `growth` (0..1) takes a tree from seed to full
 * size: the sapling rises first and the crown fills in. Withered trees turn
 * dry and droop.
 */
import { motion, useReducedMotion } from "motion/react";

import { cn } from "@/lib/utils";
import { speciesFor, type Species } from "./logic";

const BASE_X = 100;
const BASE_Y = 188;
const DRY = { leaf: "#b3a07c", leafDeep: "#8f7d5c", trunk: "#6b5a4b" };

const clamp = (v: number) => Math.min(1, Math.max(0, v));
const easeOut = (v: number) => 1 - (1 - v) ** 3;

function Crown({ species, colors }: { species: Species; colors: { leaf: string; leafDeep: string; trunk: string } }) {
  const { leaf, leafDeep, trunk } = colors;
  const shine = "rgb(255 255 255 / 0.18)";
  switch (species.shape) {
    case "cone":
      return (
        <g>
          <path d="M96 188 L98 150 L102 150 L104 188 Z" fill={trunk} />
          {[
            [40, 100, 38],
            [62, 135, 48],
            [92, 168, 56],
          ].map(([top, bottom, half], i) => (
            <g key={i}>
              <path d={`M100 ${top} L${100 - half} ${bottom} L${100 + half} ${bottom} Z`} fill={leafDeep} />
              <path d={`M100 ${top} L${100 - half} ${bottom} L100 ${bottom - 6} Z`} fill={leaf} />
            </g>
          ))}
        </g>
      );
    case "birch":
      return (
        <g>
          <path d="M96 188 L98 96 L102 96 L104 188 Z" fill={trunk} />
          {[170, 152, 136, 118].map((y, i) => (
            <path key={y} d={`M${i % 2 ? 99 : 97} ${y} h4`} stroke="#3a3330" strokeWidth="2" strokeLinecap="round" />
          ))}
          <ellipse cx="100" cy="82" rx="30" ry="44" fill={leafDeep} />
          <ellipse cx="80" cy="104" rx="20" ry="28" fill={leafDeep} />
          <ellipse cx="121" cy="98" rx="21" ry="30" fill={leaf} />
          <ellipse cx="96" cy="74" rx="24" ry="36" fill={leaf} />
          <ellipse cx="88" cy="62" rx="8" ry="12" fill={shine} />
        </g>
      );
    case "cactus":
      return (
        <g>
          <path d="M70 168 h60 l-7 22 h-46 Z" fill={trunk} />
          <rect x="66" y="162" width="68" height="9" rx="3" fill={`color-mix(in srgb, ${trunk} 80%, black)`} />
          <rect x="88" y="78" width="26" height="90" rx="13" fill={leafDeep} />
          <rect x="88" y="78" width="16" height="90" rx="8" fill={leaf} />
          <path d="M88 132 h-10 a8 8 0 0 1 -8 -8 v-22" stroke={leafDeep} strokeWidth="14" strokeLinecap="round" fill="none" />
          <path d="M114 118 h10 a8 8 0 0 0 8 -8 v-18" stroke={leaf} strokeWidth="13" strokeLinecap="round" fill="none" />
          {[96, 112, 128, 144].map((y) => (
            <circle key={y} cx="101" cy={y} r="1.3" fill="rgb(255 255 255 / 0.55)" />
          ))}
        </g>
      );
    default: {
      // Round crowns: oak, cherry blossom, maple.
      const blobs: [number, number, number][] =
        species.shape === "maple"
          ? [
              [100, 92, 36],
              [70, 108, 24],
              [130, 108, 24],
              [84, 72, 24],
              [118, 70, 25],
              [100, 58, 20],
            ]
          : [
              [100, 96, 38],
              [72, 112, 26],
              [128, 112, 26],
              [86, 78, 25],
              [116, 76, 27],
            ];
      return (
        <g>
          <path d="M94 188 C96 160 97 140 97 118 L103 118 C103 140 104 160 106 188 Z" fill={trunk} />
          <path d="M99 146 C92 138 86 134 78 132" stroke={trunk} strokeWidth="4" strokeLinecap="round" fill="none" />
          <path d="M101 136 C108 128 114 124 122 122" stroke={trunk} strokeWidth="4" strokeLinecap="round" fill="none" />
          {blobs.map(([x, y, r], i) => (
            <circle key={`d${i}`} cx={x} cy={y + 5} r={r} fill={leafDeep} />
          ))}
          {blobs.map(([x, y, r], i) => (
            <circle key={`l${i}`} cx={x - 2} cy={y} r={r * 0.9} fill={leaf} />
          ))}
          <circle cx="86" cy="76" r="9" fill={shine} />
          {species.shape === "blossom"
            ? [
                [80, 100],
                [112, 88],
                [96, 70],
                [124, 110],
                [70, 116],
                [104, 108],
                [88, 90],
              ].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3.2" fill="#fff4f8" />)
            : null}
          {species.shape === "maple"
            ? [
                [82, 96],
                [118, 84],
                [104, 112],
                [70, 112],
              ].map(([x, y]) => <circle key={`${x}${y}`} cx={x} cy={y} r="3" fill="#b8361f" opacity="0.7" />)
            : null}
        </g>
      );
    }
  }
}

export function Tree({
  species: speciesKey,
  growth = 1,
  withered = false,
  sway = false,
  ground = true,
  className,
}: {
  species: string;
  growth?: number;
  withered?: boolean;
  /** Gentle movement while growing. */
  sway?: boolean;
  ground?: boolean;
  className?: string;
}) {
  const reduce = useReducedMotion();
  const species = speciesFor(speciesKey);
  const colors = withered ? DRY : species;
  const g = clamp(growth);
  const sprout = g < 0.1;
  const scale = 0.2 + 0.8 * easeOut(clamp((g - 0.04) / 0.96));

  return (
    <svg viewBox="0 0 200 210" className={cn("overflow-visible", className)} role="img" aria-label={`${species.name}${withered ? ", withered" : ""}`}>
      {ground ? (
        <>
          <ellipse cx={BASE_X} cy={BASE_Y + 4} rx="74" ry="11" fill="color-mix(in srgb, #8a6a4a 32%, transparent)" />
          <ellipse cx={BASE_X} cy={BASE_Y + 2} rx="54" ry="7" fill="color-mix(in srgb, #6fae5c 45%, transparent)" />
        </>
      ) : null}
      {sprout && !withered ? (
        <motion.g
          initial={{ scale: 0.4, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6 }}
          style={{ originX: 0.5, originY: 1 }}
        >
          <ellipse cx={BASE_X} cy={BASE_Y - 2} rx="9" ry="5" fill="#7a5a3a" />
          <path d={`M${BASE_X} ${BASE_Y - 4} C${BASE_X} ${BASE_Y - 14} ${BASE_X} ${BASE_Y - 18} ${BASE_X} ${BASE_Y - 22}`} stroke={species.leafDeep} strokeWidth="3" strokeLinecap="round" fill="none" />
          <ellipse cx={BASE_X - 7} cy={BASE_Y - 24} rx="8" ry="4.5" transform={`rotate(-25 ${BASE_X - 7} ${BASE_Y - 24})`} fill={species.leaf} />
          <ellipse cx={BASE_X + 7} cy={BASE_Y - 26} rx="8" ry="4.5" transform={`rotate(25 ${BASE_X + 7} ${BASE_Y - 26})`} fill={species.leafDeep} />
        </motion.g>
      ) : (
        <motion.g
          initial={false}
          animate={{
            scaleX: scale,
            scaleY: withered ? scale * 0.94 : scale,
            rotate: withered ? -6 : sway && !reduce ? [0, 1.4, 0, -1.4, 0] : 0,
          }}
          transition={{
            scaleX: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
            scaleY: { duration: 0.9, ease: [0.16, 1, 0.3, 1] },
            rotate: sway && !withered ? { duration: 6, repeat: Infinity, ease: "easeInOut" } : { duration: 0.8 },
          }}
          style={{ originX: 0.5, originY: 1 }}
        >
          <Crown species={species} colors={colors} />
        </motion.g>
      )}
      {withered
        ? [
            [70, 196, -20],
            [128, 194, 30],
            [110, 199, 70],
          ].map(([x, y, r]) => (
            <ellipse key={`${x}`} cx={x} cy={y} rx="5" ry="2.4" transform={`rotate(${r} ${x} ${y})`} fill={DRY.leafDeep} />
          ))
        : null}
    </svg>
  );
}
