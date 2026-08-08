import { mat3 } from "gl-matrix";
import { TILE_SIZE } from "./Tile";

export const CHUNK_VIEW_PROJECTION = mat3.fromValues(2 / TILE_SIZE, 0, 0, 0, 2 / TILE_SIZE, 0, -1, -1, 1);
