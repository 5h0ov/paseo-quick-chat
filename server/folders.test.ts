import { describe, expect, it } from "vitest";
import { rank } from "./folders";

describe("rank", () => {
  // Paseo's fuzzy search matches any path with the letters in order, so a search for
  // "photo-editor" put unrelated folders ahead of the project's own.
  const found = [
    "C:\\Users\\alex\\go\\pkg\\mod\\example.com\\pathtool@v1.0.0",
    "C:\\Users\\alex\\Videos\\photos_to_edit_later",
    "D:\\Projects\\Photo Editor Pro\\assets",
    "D:\\Projects\\PhotoEditor",
    "D:\\Projects\\Photo Editor Pro",
  ];

  it("shows folders named like the search, exact first, and drops loose matches", () => {
    expect(rank(found, "photo-editor")).toEqual([
      "D:\\Projects\\PhotoEditor",
      "D:\\Projects\\Photo Editor Pro",
      "D:\\Projects\\Photo Editor Pro\\assets",
    ]);
  });

  // Cargo's build folders repeat the crate name and sat right under the project.
  it("puts build output after the project it was built from", () => {
    const folders = [
      "D:\\cargo-target\\debug\\build\\notes-app-1a2b3c4d5e6f7a8b",
      "C:\\Users\\alex\\code\\notes-app\\assets",
      "C:\\Users\\alex\\code\\notes-app",
    ];
    expect(rank(folders, "notes-app")).toEqual([folders[2], folders[1], folders[0]]);
  });
});
