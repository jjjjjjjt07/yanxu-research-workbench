declare module '@citation-js/core' {
  export const plugins: {
    input: {
      chain(
        input: string,
        options: { forceType: string; generateGraph: boolean },
      ): Record<string, unknown>[];
    };
  };
}
declare module '@citation-js/plugin-bibtex';
