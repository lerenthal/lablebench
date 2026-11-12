/**
 * Substitute `{name}` placeholders in a translated sentence.
 *
 * The dictionary is flat and its keys come from a typed union, so a value is
 * a plain sentence with named holes in it. Keeping the substitution here
 * means a translator never has to learn a template syntax, and it means the
 * sentence stays a sentence in the locale file.
 *
 *   interpolate("Overflows by {px} px", { px: 12 })  ->  "Overflows by 12 px"
 *
 * A placeholder with no matching parameter is left alone: a missing value is
 * a bug worth seeing, not one worth hiding.
 */
export const interpolate = (
  template: string,
  params?: Record<string, string | number>,
): string => {
  if (!params) {
    return template;
  }
  return template.replace(/\{(\w+)\}/g, (match: string, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
};
