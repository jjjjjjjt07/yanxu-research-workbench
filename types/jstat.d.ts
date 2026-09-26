declare module 'jstat' {
  const library: {
    jStat: {
      ibeta(x: number, a: number, b: number): number;
      studentt: { inv(probability: number, degreesOfFreedom: number): number };
    };
  };
  export default library;
}
