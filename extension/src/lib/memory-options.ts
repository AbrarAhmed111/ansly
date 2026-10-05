/**
 * Choices for Application Memory facts edited inline from an answer (by the fact's label, as the API names it).
 * Mirrors FACT_KEYS in llm/src/app/memory/keys.py; a fact not listed here is edited as text.
 */
export const MEMORY_OPTIONS: Record<string, string[]> = {
  Relocation: ['Yes', 'No', 'Depends on the role'],
  'Willingness to travel': ['Yes', 'No', 'Occasionally'],
  'Preferred work arrangement': ['Remote', 'Hybrid', 'On-site', 'Flexible'],
  'Visa sponsorship': ['Yes', 'No'],
}
