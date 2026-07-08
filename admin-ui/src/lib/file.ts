/**
 * Reads a file as base64 (without the `data:...;base64,` prefix). Used for the
 * evidence PDF upload of the manual acceptance flow (API: evidenceDocument).
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result !== 'string') {
        reject(new Error('The file could not be read.'));
        return;
      }
      const comma = result.indexOf(',');
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error ?? new Error('Read error.'));
    reader.readAsDataURL(file);
  });
}
