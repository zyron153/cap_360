// E-Factura Cape Verde — type definitions
// API shape based on SAF-T CV standard (mw.efatura.cv middleware)
// ponytail: exact endpoint paths TBD — swap when Manual Técnico v11 is available

export interface EFaturaConfig {
  enabled: boolean;
  sandbox: boolean;
  endpoint: string;        // e.g. "https://mw.efatura.cv"
  nifContribuinte: string; // Tax ID of the issuing clinic
  apiKey: string;          // Bearer token / API key
  nomeEmpresa: string;     // Company name on invoice
}

// SAF-T CV invoice payload sent to middleware
export interface EFaturaInvoicePayload {
  TaxRegistrationNumber: string;
  CompanyName: string;
  Invoice: {
    InvoiceNo: string;        // e.g. "INV-2024-0001"
    InvoiceDate: string;      // "YYYY-MM-DD"
    InvoiceType: "FT" | "FR" | "ND" | "NC"; // FT=Fatura, FR=Fatura-Recibo
    DocumentStatus: "N" | "A"; // N=Normal, A=Anulado
    CustomerTaxRegistrationNumber?: string;
    CustomerName: string;
    Lines: EFaturaLine[];
    DocumentTotals: {
      TaxPayable: number;
      NetTotal: number;
      GrossTotal: number;
    };
  };
}

export interface EFaturaLine {
  LineNumber: number;
  ProductCode: string;
  ProductDescription: string;
  Quantity: number;
  UnitOfMeasure: string;
  UnitPrice: number;
  TaxPointDate: string;
  DebitAmount: number;
}

// Response from middleware after successful submission
export interface EFaturaSubmitResponse {
  atcud: string;      // e.g. "ABCDE12345-1"
  referencia: string; // E-Factura document reference
  status: "accepted" | "rejected" | "pending";
  errorCode?: string;
  errorMessage?: string;
}

// Bull job payloads
export interface EFaturaSubmitJob {
  invoiceId: string;
}

export interface EFaturaCancelJob {
  invoiceId: string;
  efaturaRef: string;
}
