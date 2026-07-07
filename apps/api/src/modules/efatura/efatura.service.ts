import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import type {
  EFaturaConfig,
  EFaturaInvoicePayload,
  EFaturaSubmitResponse,
} from "./efatura.types";

@Injectable()
export class EFaturaService {
  private readonly logger = new Logger(EFaturaService.name);

  constructor(private readonly prisma: PrismaService) {}

  async getConfig(): Promise<EFaturaConfig | null> {
    const row = await this.prisma.setting.findUnique({
      where: { key: "integration_efatura" },
    });
    if (!row) return null;
    const cfg = row.value as unknown as EFaturaConfig;
    if (!cfg.enabled || !cfg.apiKey || !cfg.nifContribuinte) return null;
    return cfg;
  }

  // ponytail: POST path TBD — swap when Manual Técnico v11 confirms route
  async submitInvoice(
    cfg: EFaturaConfig,
    payload: EFaturaInvoicePayload
  ): Promise<EFaturaSubmitResponse> {
    const baseUrl = cfg.sandbox
      ? "https://sandbox.mw.efatura.cv"
      : cfg.endpoint;

    const res = await fetch(`${baseUrl}/api/v1/invoices`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${cfg.apiKey}`,
        "X-NIF": cfg.nifContribuinte,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`E-Factura HTTP ${res.status}: ${text}`);
    }

    return res.json() as Promise<EFaturaSubmitResponse>;
  }

  // ponytail: cancel path TBD — swap when manual is available
  async cancelInvoice(
    cfg: EFaturaConfig,
    efaturaRef: string
  ): Promise<void> {
    const baseUrl = cfg.sandbox
      ? "https://sandbox.mw.efatura.cv"
      : cfg.endpoint;

    const res = await fetch(
      `${baseUrl}/api/v1/invoices/${encodeURIComponent(efaturaRef)}/cancel`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${cfg.apiKey}`,
          "X-NIF": cfg.nifContribuinte,
        },
      }
    );

    if (!res.ok) {
      const text = await res.text().catch(() => res.statusText);
      throw new Error(`E-Factura cancel HTTP ${res.status}: ${text}`);
    }
  }

  buildPayload(
    cfg: EFaturaConfig,
    invoice: {
      invoiceNumber: string;
      issuedAt: Date | null;
      patient: { fullName: string; nif?: string | null };
      items: Array<{
        description: string;
        quantity: number;
        unitPrice: number | string;
        total: number | string;
        serviceId?: string | null;
      }>;
      subtotal: number | string;
      total: number | string;
    }
  ): EFaturaInvoicePayload {
    const date = (invoice.issuedAt ?? new Date()).toISOString().slice(0, 10);
    const grossTotal = Number(invoice.total);

    return {
      TaxRegistrationNumber: cfg.nifContribuinte,
      CompanyName: cfg.nomeEmpresa,
      Invoice: {
        InvoiceNo: invoice.invoiceNumber,
        InvoiceDate: date,
        InvoiceType: "FT",
        DocumentStatus: "N",
        CustomerTaxRegistrationNumber: invoice.patient.nif ?? undefined,
        CustomerName: invoice.patient.fullName,
        Lines: invoice.items.map((item, i) => ({
          LineNumber: i + 1,
          ProductCode: item.serviceId ?? "SVC",
          ProductDescription: item.description,
          Quantity: item.quantity,
          UnitOfMeasure: "UN",
          UnitPrice: Number(item.unitPrice),
          TaxPointDate: date,
          DebitAmount: Number(item.total),
        })),
        DocumentTotals: {
          TaxPayable: 0,     // ponytail: VAT rate TBD (Cape Verde IVA)
          NetTotal: grossTotal,
          GrossTotal: grossTotal,
        },
      },
    };
  }
}
