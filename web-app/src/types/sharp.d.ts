declare module "sharp" {
  type RawOptions = {
    raw: {
      width: number;
      height: number;
      channels: 4;
    };
  };

  type SharpInstance = {
    ensureAlpha(): SharpInstance;
    raw(): SharpInstance;
    toBuffer(options: {
      resolveWithObject: true;
    }): Promise<{
      data: Buffer;
      info: {
        width: number;
        height: number;
        channels: number;
      };
    }>;
    png(): SharpInstance;
    toFile(outputPath: string): Promise<unknown>;
  };

  function sharp(input?: string | Buffer, options?: RawOptions): SharpInstance;
  export default sharp;
}
