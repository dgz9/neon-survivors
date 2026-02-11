export class SpatialGrid {
  private cellSize: number;
  private cols: number;
  private rows: number;
  private bucketSize: number;
  private cells: Int32Array;
  private cellCounts: Int32Array;

  constructor(width: number, height: number, cellSize = 128, bucketSize = 32) {
    this.cellSize = cellSize;
    this.bucketSize = bucketSize;
    this.cols = Math.max(1, Math.ceil(width / cellSize));
    this.rows = Math.max(1, Math.ceil(height / cellSize));
    const totalCells = this.cols * this.rows;
    this.cells = new Int32Array(totalCells * bucketSize);
    this.cellCounts = new Int32Array(totalCells);
  }

  resize(width: number, height: number): void {
    const newCols = Math.max(1, Math.ceil(width / this.cellSize));
    const newRows = Math.max(1, Math.ceil(height / this.cellSize));
    if (newCols !== this.cols || newRows !== this.rows) {
      this.cols = newCols;
      this.rows = newRows;
      const totalCells = this.cols * this.rows;
      this.cells = new Int32Array(totalCells * this.bucketSize);
      this.cellCounts = new Int32Array(totalCells);
    }
  }

  clear(): void {
    this.cellCounts.fill(0);
  }

  insert(entityIndex: number, x: number, y: number): void {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);
    if (col < 0 || col >= this.cols || row < 0 || row >= this.rows) return;

    const cellIndex = row * this.cols + col;
    const count = this.cellCounts[cellIndex];
    if (count >= this.bucketSize) return;

    this.cells[cellIndex * this.bucketSize + count] = entityIndex;
    this.cellCounts[cellIndex] = count + 1;
  }

  query(x: number, y: number, callback: (entityIndex: number) => void): void {
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    for (let dr = -1; dr <= 1; dr++) {
      for (let dc = -1; dc <= 1; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;

        const cellIndex = r * this.cols + c;
        const count = this.cellCounts[cellIndex];
        const base = cellIndex * this.bucketSize;

        for (let i = 0; i < count; i++) {
          callback(this.cells[base + i]);
        }
      }
    }
  }

  queryRadius(x: number, y: number, radius: number, callback: (entityIndex: number) => void): void {
    const cellRadius = Math.ceil(radius / this.cellSize);
    const col = Math.floor(x / this.cellSize);
    const row = Math.floor(y / this.cellSize);

    for (let dr = -cellRadius; dr <= cellRadius; dr++) {
      for (let dc = -cellRadius; dc <= cellRadius; dc++) {
        const c = col + dc;
        const r = row + dr;
        if (c < 0 || c >= this.cols || r < 0 || r >= this.rows) continue;

        const cellIndex = r * this.cols + c;
        const count = this.cellCounts[cellIndex];
        const base = cellIndex * this.bucketSize;

        for (let i = 0; i < count; i++) {
          callback(this.cells[base + i]);
        }
      }
    }
  }
}
