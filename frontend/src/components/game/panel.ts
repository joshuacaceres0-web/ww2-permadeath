// One panel language for everything that floats on the battlefield
// (Josh, 2026-11-12: the in-battle menu was an eyesore — three
// different backgrounds, two different "selected" styles, loose
// rows of mismatched buttons). Every in-battle surface uses these:
// same border, same dark glass, same shadow, same label type, and
// ONE selected state (amber). Semantic colors survive only as
// foreground accents: amber = selected / leader, teal = radio /
// info, red = danger. Chrome is identical everywhere.
//
// Controls quiet down at rest (85% opacity) and come to full
// strength on hover or while anything inside has focus, so the
// battlefield reads through them until they are needed. Modal and
// dropdown surfaces use the solid variant (full strength always:
// the player is working in them, not looking past them).

/** Floating panel chrome (translucent). */
export const PANEL =
  "border border-[#2E3628] bg-[#0D0F0C]/80 shadow-[0_2px_12px_rgba(0,0,0,0.5)]";

/** Panel chrome for surfaces the player works inside (menus,
 * dropdowns): near-solid so text stays readable over the field. */
export const PANEL_SOLID =
  "border border-[#2E3628] bg-[#0D0F0C]/95 shadow-[0_4px_18px_rgba(0,0,0,0.6)] backdrop-blur-[2px]";

/** Quiet at rest, full strength on hover / focus-within. */
export const PANEL_REST =
  "opacity-85 transition-opacity duration-200 hover:opacity-100 focus-within:opacity-100";

/** Small caps section label, same voice on every panel. */
export const PANEL_LABEL =
  "font-mono text-[9px] uppercase tracking-[0.25em] text-[#75826F]";

/** In-battle control button chrome. Sizes stay with the caller
 * (desktop cluster vs thumb-sized touch targets). */
export const PANEL_BTN =
  "border border-[#2E3628] bg-[#0D0F0C]/60 font-mono tracking-wider text-[#8D9A83] transition-colors duration-150 hover:border-[#5A664F] hover:text-[#E3E7DC] disabled:opacity-40";

/** The one selected state, everywhere: orders, formations,
 * the picked card. Amber fill, dark gold border, pale gold text. */
export const PANEL_BTN_ACTIVE =
  "border-[#E5A93C] bg-[#3A2B0E] text-[#FFD97D] hover:border-[#E5A93C] hover:text-[#FFD97D]";
