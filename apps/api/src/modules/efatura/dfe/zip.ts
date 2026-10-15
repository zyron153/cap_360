import { strToU8, zipSync } from "fflate";

/** A ZIP (Deflate) holding one XML file — the multipart payload POST /v1/dfe and /v1/event expect.
 * The entry must be named after the document: `<IUD>.xml` / `<eventId>.xml`. */
export function zipXml(entryName: string, xml: string): Buffer {
  return Buffer.from(zipSync({ [entryName]: strToU8(xml) }, { level: 6 }));
}
