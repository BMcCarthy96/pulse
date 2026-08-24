import { fileURLToPath } from "node:url";
import sharp from "sharp";

const source = fileURLToPath(new URL("../public/pulse-demo-card.svg", import.meta.url));
const output = fileURLToPath(new URL("../public/pulse-demo-card.png", import.meta.url));

await sharp(source).resize(1200, 630).png({ compressionLevel: 9 }).toFile(output);
console.log(`Generated ${output}`);
