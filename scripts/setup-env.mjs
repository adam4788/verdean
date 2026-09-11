import { constants } from "node:fs";
import { copyFile } from "node:fs/promises";

const source = new URL("../.env.example", import.meta.url);
const target = new URL("../.env.local", import.meta.url);

try {
  await copyFile(source, target, constants.COPYFILE_EXCL);
  console.log("Created .env.local from .env.example.");
} catch (error) {
  if (error && typeof error === "object" && "code" in error && error.code === "EEXIST") {
    console.log("Kept existing .env.local unchanged.");
  } else {
    throw error;
  }
}