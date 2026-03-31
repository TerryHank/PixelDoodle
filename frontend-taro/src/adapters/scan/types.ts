export interface ScanAdapter {
  scanDevice(): Promise<string>
}
