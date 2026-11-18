/**
 * Who printed the label.
 *
 * The lab asked for a "username" field. The app has no users: `authMode` is
 * `none`, there is no session and no `/api/me`, so there is nothing it could
 * honestly print under that name. What it can do is let each workstation say
 * who is at it, and put that on the label - which is the thing the field was
 * wanted for, and is a different claim from an authenticated identity.
 *
 * So this is a *local* setting, kept per browser, and the UI says so. It is
 * exposed through the same merge-variable machinery as everything else, as
 * `{operator}`, which is how it reaches the canvas, the print preview and the
 * CSV batch without any of them having to know about it.
 */

/** The merge variable the operator's name fills. */
export const OPERATOR_KEY = "operator";

/** The token an Operator object stores in the template. */
export const operatorToken = (): string => `{${OPERATOR_KEY}}`;

/**
 * Fill `{operator}` with this workstation's operator name.
 *
 * A CSV column bound to `operator` wins: a spreadsheet that names who
 * prepared each row is stating a fact about that row, while the workstation
 * setting is only a stand-in for having no users at all. So the binding is
 * checked rather than assumed away.
 */
export const applyOperator = (
  values: Record<string, string>,
  operator: string,
  boundColumns: Record<string, string> = {},
): Record<string, string> => {
  if (boundColumns[OPERATOR_KEY] !== undefined) {
    return values;
  }

  return { ...values, [OPERATOR_KEY]: operator.trim() };
};
