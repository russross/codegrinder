interface PythonOutputWriter {
  write(buffer: Uint8Array): number;
}

function createPythonOutputWriter(output: (value: string) => void): PythonOutputWriter {
  const decoder = new TextDecoder();

  return {
    write(buffer: Uint8Array): number {
      const value = decoder.decode(buffer, { stream: true });
      if (value !== "") {
        output(value);
      }
      return buffer.byteLength;
    },
  };
}

export { createPythonOutputWriter, type PythonOutputWriter };
