import { PrismaClient } from "@prisma/client";
import * as argon2 from "argon2";
import { createCipheriv, createHmac, randomBytes } from "crypto";

const prisma = new PrismaClient();

// Same algorithm as apps/api's EncryptionService, duplicated here rather than imported —
// packages/database can't depend on apps/api (that's the wrong direction of the dependency
// graph). Only used to seed encrypted columns (Patient.dateOfBirth/nif) with data the API can
// actually decrypt back.
const ENCRYPTION_KEY = Buffer.from(process.env.FIELD_ENCRYPTION_KEY ?? "", "hex");
function encryptField(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return `${iv.toString("hex")}:${cipher.getAuthTag().toString("hex")}:${encrypted.toString("hex")}`;
}
function blindIndex(plaintext: string): string {
  return createHmac("sha256", ENCRYPTION_KEY).update(`blind-index:${plaintext}`).digest("hex");
}

// Dev/seed login for every staff account below — obviously not for production use.
const SEED_PASSWORD = "Teste@1234";

// Fixed id for the admin only, so it matches SessionAuthGuard's AUTH_BYPASS dev-admin fallback
// sub (see common/guards/session-auth.guard.ts) — every other staff member gets a fresh uuid.
const ADMIN_ID = "65093d59-792a-4792-bfc3-300c37725ac9";

const COMPANY_IDS = {
  impar:    "c0000000-0000-0000-0000-000000000001",
  bcaSaude: "c0000000-0000-0000-0000-000000000002",
  garantia: "c0000000-0000-0000-0000-000000000003",
};

async function main() {
  console.warn("Seeding database...");
  const passwordHash = await argon2.hash(SEED_PASSWORD, { type: argon2.argon2id });

  // ─── Services ──────────────────────────────────────────────────────────────
  const services = await Promise.all([
    prisma.service.upsert({
      where: { code: "CONS-GERAL" },
      update: {},
      create: {
        name: "Consulta Geral",
        code: "CONS-GERAL",
        description: "Consulta médica geral",
        durationMinutes: 30,
        price: 1500,
      },
    }),
    prisma.service.upsert({
      where: { code: "CONS-ESP" },
      update: {},
      create: {
        name: "Consulta Especialidade",
        code: "CONS-ESP",
        description: "Consulta com especialista",
        durationMinutes: 45,
        price: 2500,
      },
    }),
    prisma.service.upsert({
      where: { code: "EXAM-LAB" },
      update: {},
      create: {
        name: "Exame Laboratorial",
        code: "EXAM-LAB",
        description: "Análises clínicas",
        durationMinutes: 15,
        price: 800,
      },
    }),
    prisma.service.upsert({
      where: { code: "EXAM-ULTRA" },
      update: {},
      create: {
        name: "Ecografia",
        code: "EXAM-ULTRA",
        description: "Exame de ecografia",
        durationMinutes: 30,
        price: 3500,
      },
    }),
    prisma.service.upsert({
      where: { code: "DENT-CONS" },
      update: {},
      create: {
        name: "Consulta Dentária",
        code: "DENT-CONS",
        description: "Consulta de medicina dentária",
        durationMinutes: 45,
        price: 2000,
      },
    }),
    prisma.service.upsert({
      where: { code: "HOME-VISIT" },
      update: {},
      create: {
        name: "Visita Domiciliária",
        code: "HOME-VISIT",
        description: "Consulta no domicílio do paciente",
        durationMinutes: 60,
        price: 4000,
      },
    }),
  ]);

  // ─── Companies ─────────────────────────────────────────────────────────────
  const [compImpar, compBca, compGarantia] = await Promise.all([
    prisma.company.upsert({
      where: { id: COMPANY_IDS.impar },
      update: {},
      create: { id: COMPANY_IDS.impar, name: "IMPAR", taxId: "CV-IMPAR-001", email: "comercial@impar.cv", phone: "+2382610001", address: "Av. Cidade de Lisboa, Praia, Santiago" },
    }),
    prisma.company.upsert({
      where: { id: COMPANY_IDS.bcaSaude },
      update: {},
      create: { id: COMPANY_IDS.bcaSaude, name: "BCA Saúde", taxId: "CV-BCA-SAUDE-002", email: "saude@bca.cv", phone: "+2382610002", address: "Rua do BCA, Praia, Santiago" },
    }),
    prisma.company.upsert({
      where: { id: COMPANY_IDS.garantia },
      update: {},
      create: { id: COMPANY_IDS.garantia, name: "Garantia", taxId: "CV-GARANTIA-003", email: "seguros@garantia.cv", phone: "+2382610003", address: "Plateau, Praia, Santiago" },
    }),
  ]);

  // ─── Health Plan Products ───────────────────────────────────────────────────
  await Promise.all([
    prisma.healthPlanProduct.upsert({ where: { code: "IMPAR-FAM-001" }, update: {}, create: { name: "Plano Familiar Ouro",        code: "IMPAR-FAM-001", companyId: compImpar.id,    monthlyFee: 4800,  coverageRules: { type: "familiar",   coverage: 85 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "IMPAR-IND-001" }, update: {}, create: { name: "Plano Individual Plus",       code: "IMPAR-IND-001", companyId: compImpar.id,    monthlyFee: 1200,  coverageRules: { type: "particular", coverage: 70 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "IMPAR-FAM-002" }, update: {}, create: { name: "Plano Familiar Bronze",       code: "IMPAR-FAM-002", companyId: compImpar.id,    monthlyFee: 2400,  coverageRules: { type: "familiar",   coverage: 65 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "BCA-CORP-001"  }, update: {}, create: { name: "Corporativo Saúde Total",     code: "BCA-CORP-001",  companyId: compBca.id,      monthlyFee: 18000, coverageRules: { type: "corp",       coverage: 90 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "BCA-CORP-002"  }, update: {}, create: { name: "Empresarial Premium",         code: "BCA-CORP-002",  companyId: compBca.id,      monthlyFee: 14400, coverageRules: { type: "corp",       coverage: 95 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "GAR-FAM-001"   }, update: {}, create: { name: "Familiar Prata",              code: "GAR-FAM-001",   companyId: compGarantia.id, monthlyFee: 3200,  coverageRules: { type: "familiar",   coverage: 75 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "GAR-CORP-001"  }, update: {}, create: { name: "Corporativo Essencial",       code: "GAR-CORP-001",  companyId: compGarantia.id, monthlyFee: 9000,  coverageRules: { type: "corp",       coverage: 80 } } }),
    prisma.healthPlanProduct.upsert({ where: { code: "GAR-IND-001"   }, update: {}, create: { name: "Particular Básico",           code: "GAR-IND-001",   companyId: compGarantia.id, monthlyFee: 800,   coverageRules: { type: "particular", coverage: 60 }, active: false } }),
  ]);

  // ─── Rooms ─────────────────────────────────────────────────────────────────
  const rooms = await Promise.all([
    prisma.room.upsert({
      where: { id: "00000000-0000-0000-0000-000000000001" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000001",
        name: "Consultório 1",
        floor: "R/C",
        capacity: 1,
        equipment: { items: ["estetoscópio", "esfigmomanómetro"] },
      },
    }),
    prisma.room.upsert({
      where: { id: "00000000-0000-0000-0000-000000000002" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000002",
        name: "Consultório 2",
        floor: "R/C",
        capacity: 1,
        equipment: { items: ["estetoscópio", "esfigmomanómetro"] },
      },
    }),
    prisma.room.upsert({
      where: { id: "00000000-0000-0000-0000-000000000003" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000003",
        name: "Sala de Ecografia",
        floor: "1º",
        capacity: 1,
        equipment: { items: ["ecógrafo Mindray DC-80"] },
      },
    }),
    prisma.room.upsert({
      where: { id: "00000000-0000-0000-0000-000000000004" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000004",
        name: "Laboratório",
        floor: "1º",
        capacity: 3,
        equipment: { items: ["centrifugadora", "microscópio", "hemograma automático"] },
      },
    }),
    prisma.room.upsert({
      where: { id: "00000000-0000-0000-0000-000000000005" },
      update: {},
      create: {
        id: "00000000-0000-0000-0000-000000000005",
        name: "Sala de Dentária",
        floor: "1º",
        capacity: 1,
        equipment: { items: ["cadeira dentária", "unidade de raio-X dental"] },
      },
    }),
  ]);

  // ─── Staff ─────────────────────────────────────────────────────────────────
  // Every account below logs in with email + SEED_PASSWORD ("Teste@1234") — dev/seed data only.
  const [drSilva, drCosta, nurseAndrade, recepAna, recepJoao, labPedro, adminUser] =
    await Promise.all([
      prisma.staff.upsert({
        where: { email: "dr.silva@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "Dr. Carlos Silva",
          email: "dr.silva@cap.cv",
          role: "doctor",
          specialtyCode: "CLINICA-GERAL",
          phone: "+2389912345",
        },
      }),
      prisma.staff.upsert({
        where: { email: "dr.costa@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "Dra. Ana Costa",
          email: "dr.costa@cap.cv",
          role: "doctor",
          specialtyCode: "PEDIATRIA",
          phone: "+2389923456",
        },
      }),
      prisma.staff.upsert({
        where: { email: "maria.nurse@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "Maria Andrade",
          email: "maria.nurse@cap.cv",
          role: "nurse",
          phone: "+2389934567",
        },
      }),
      prisma.staff.upsert({
        where: { email: "ana.recepcao@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "Ana Lopes",
          email: "ana.recepcao@cap.cv",
          role: "receptionist",
          phone: "+2389945678",
        },
      }),
      prisma.staff.upsert({
        where: { email: "joao.recepcao@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "João Monteiro",
          email: "joao.recepcao@cap.cv",
          role: "receptionist",
          phone: "+2389956789",
        },
      }),
      prisma.staff.upsert({
        where: { email: "pedro.lab@cap.cv" },
        update: { passwordHash }, // backfills existing rows that predate this column
        create: {
          passwordHash,
          fullName: "Pedro Ferreira",
          email: "pedro.lab@cap.cv",
          role: "lab_tech",
          phone: "+2389967890",
        },
      }),
      prisma.staff.upsert({
        where: { id: ADMIN_ID },
        update: {},
        create: {
          id: ADMIN_ID,
          passwordHash,
          fullName: "Administrador Sistema",
          email: "capjacobvicente@gmail.com",
          role: "admin",
        },
      }),
    ]);

  // ─── Staff availability (recurring weekly schedule) ─────────────────────────
  // Dr. Silva: Mon–Fri 08:00–13:00
  for (const day of [1, 2, 3, 4, 5]) {
    await prisma.staffAvailability.upsert({
      where: { staffId_dayOfWeek_startTime: { staffId: drSilva.id, dayOfWeek: day, startTime: "08:00" } },
      update: {},
      create: { staffId: drSilva.id, dayOfWeek: day, startTime: "08:00", endTime: "13:00" },
    });
  }
  // Dr. Costa: Mon/Wed/Fri 14:00–18:00
  for (const day of [1, 3, 5]) {
    await prisma.staffAvailability.upsert({
      where: { staffId_dayOfWeek_startTime: { staffId: drCosta.id, dayOfWeek: day, startTime: "14:00" } },
      update: {},
      create: { staffId: drCosta.id, dayOfWeek: day, startTime: "14:00", endTime: "18:00" },
    });
  }

  // ─── Sample Patients ────────────────────────────────────────────────────────
  const [p1, p2, p3, p4, p5] = await Promise.all([  // p6 (João Duarte) seeded but not used in appointments
    prisma.patient.upsert({
      where: { phone: "+2389800001" },
      update: {},
      create: {
        fullName: "João Barros",
        dateOfBirth: encryptField("1985-03-15"),
        gender: "male",
        phone: "+2389800001",
        email: "joao.barros@email.com",
        nif: encryptField("123456789"),
        nifHash: blindIndex("123456789"),
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
    prisma.patient.upsert({
      where: { phone: "+2389800002" },
      update: {},
      create: {
        fullName: "Maria Tavares",
        dateOfBirth: encryptField("1992-07-22"),
        gender: "female",
        phone: "+2389800002",
        email: "maria.tavares@email.com",
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
    prisma.patient.upsert({
      where: { phone: "+2389800003" },
      update: {},
      create: {
        fullName: "António Fonseca",
        dateOfBirth: encryptField("1978-11-08"),
        gender: "male",
        phone: "+2389800003",
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
    prisma.patient.upsert({
      where: { phone: "+2389800004" },
      update: {},
      create: {
        fullName: "Carla Neves",
        dateOfBirth: encryptField("2001-05-30"),
        gender: "female",
        phone: "+2389800004",
        email: "carla.neves@email.com",
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
    prisma.patient.upsert({
      where: { phone: "+2389800005" },
      update: {},
      create: {
        fullName: "Pedro Gonçalves",
        dateOfBirth: encryptField("1955-09-12"),
        gender: "male",
        phone: "+2389800005",
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
    prisma.patient.upsert({
      where: { phone: "+9656565" },
      update: {},
      create: {
        fullName: "João Duarte",
        dateOfBirth: encryptField("2006-01-02"),
        gender: "male",
        phone: "+9656565",
        email: "teste@mail.com",
        consentGiven: true,
        consentGivenAt: new Date(),
      },
    }),
  ]);

  // ─── Sample Appointments (next 7 days) ─────────────────────────────────────
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(9, 0, 0, 0);

  const makeSlot = (daysOffset: number, hour: number): Date => {
    const d = new Date();
    d.setDate(d.getDate() + daysOffset);
    d.setHours(hour, 0, 0, 0);
    return d;
  };

  const consGeral = services.find((s) => s.code === "CONS-GERAL")!;
  const consEsp   = services.find((s) => s.code === "CONS-ESP")!;
  const examLab   = services.find((s) => s.code === "EXAM-LAB")!;

  const room1 = rooms[0];
  const room2 = rooms[1];

  const appointmentsData = [
    { patientId: p1.id, staffId: drSilva.id, serviceId: consGeral.id, roomId: room1.id, scheduledAt: makeSlot(1, 8),  status: "confirmed" as const },
    { patientId: p2.id, staffId: drSilva.id, serviceId: consGeral.id, roomId: room1.id, scheduledAt: makeSlot(1, 9),  status: "pending"   as const },
    { patientId: p3.id, staffId: drCosta.id, serviceId: consEsp.id,   roomId: room2.id, scheduledAt: makeSlot(1, 14), status: "confirmed" as const },
    { patientId: p4.id, staffId: drSilva.id, serviceId: consGeral.id, roomId: room1.id, scheduledAt: makeSlot(2, 8),  status: "pending"   as const },
    { patientId: p5.id, staffId: drCosta.id, serviceId: consEsp.id,   roomId: room2.id, scheduledAt: makeSlot(2, 14), status: "pending"   as const },
    { patientId: p1.id, staffId: drSilva.id, serviceId: examLab.id,   roomId: room1.id, scheduledAt: makeSlot(3, 10), status: "pending"   as const },
    { patientId: p2.id, staffId: drCosta.id, serviceId: consEsp.id,   roomId: room2.id, scheduledAt: makeSlot(4, 15), status: "pending"   as const },
    { patientId: p3.id, staffId: drSilva.id, serviceId: consGeral.id, roomId: room1.id, scheduledAt: makeSlot(5, 8),  status: "pending"   as const },
    // 2 past appointments (already completed)
    { patientId: p4.id, staffId: drSilva.id, serviceId: consGeral.id, roomId: room1.id, scheduledAt: makeSlot(-3, 9), status: "completed" as const },
    { patientId: p5.id, staffId: drCosta.id, serviceId: consEsp.id,   roomId: room2.id, scheduledAt: makeSlot(-1, 14), status: "completed" as const },
  ];

  for (const appt of appointmentsData) {
    await prisma.appointment.create({ data: { ...appt, source: "web" } });
  }

  // ─── Financeiro (expenses, income, invoices) ────────────────────────────────
  // ponytail: group-level idempotency (count-and-skip), same convention as seedGroup() below —
  // Expense/Income have no natural unique key to upsert against, unlike everything else here.
  const now = new Date();
  // n>0 = n months in the past, n<0 = |n| months in the future (for not-yet-due invoices).
  const monthOffset = (n: number, day: number) => new Date(now.getFullYear(), now.getMonth() - n, day);

  if ((await prisma.expense.count()) === 0) {
    const expensesData = [
      { description: "Renda do consultório — mês corrente",   category: "Renda",         amount: 45000, date: monthOffset(0, 1),  supplier: "Imobiliária Sotavento", method: "bank_transfer" as const, status: "approved" as const },
      { description: "Renda do consultório",                  category: "Renda",         amount: 45000, date: monthOffset(1, 1),  supplier: "Imobiliária Sotavento", method: "bank_transfer" as const, status: "approved" as const },
      { description: "Renda do consultório",                  category: "Renda",         amount: 45000, date: monthOffset(2, 1),  supplier: "Imobiliária Sotavento", method: "bank_transfer" as const, status: "approved" as const },
      { description: "Material de escritório e consumíveis",  category: "Fornecimentos", amount: 8500,  date: monthOffset(0, 5),  supplier: "Papelaria Central",      method: "cash" as const,          status: "approved" as const },
      { description: "Reagentes para laboratório",            category: "Fornecimentos", amount: 22000, date: monthOffset(1, 10), supplier: "MedSupply Cabo Verde",   method: "bank_transfer" as const, status: "approved" as const },
      { description: "Eletricidade — Electra",                category: "Utilidades",    amount: 12500, date: monthOffset(0, 2),  supplier: "Electra",                method: "bank_transfer" as const, status: "approved" as const },
      { description: "Manutenção do ecógrafo",                category: "Manutenção",    amount: 15000, date: monthOffset(0, 12), supplier: "TecMed Praia",           method: "bank_transfer" as const, status: "pending"  as const },
      { description: "Formação em atendimento ao cliente",    category: "Formação",      amount: 6000,  date: monthOffset(1, 20), method: "cash" as const,            status: "approved" as const },
    ];
    for (const e of expensesData) {
      await prisma.expense.create({
        data: {
          ...e,
          requestedById: recepAna.id,
          ...(e.status === "approved" ? { approvedById: adminUser.id, approvedAt: e.date } : {}),
        },
      });
    }
  }

  if ((await prisma.income.count()) === 0) {
    await prisma.income.createMany({
      data: [
        { description: "Subsídio Câmara Municipal — apoio à saúde", category: "Subsídios",  amount: 30000, date: monthOffset(1, 15) },
        { description: "Reembolso seguradora — sinistro anterior",  category: "Reembolsos", amount: 9500,  date: monthOffset(0, 3)  },
      ],
    });
  }

  // A minimal health-plan enrollment so seeded invoices have something real to link against for
  // the Financeiro Overview's payer-type breakdown — Maria Tavares (p2) on IMPAR's individual plan.
  const planIndividual = await prisma.healthPlanProduct.findUnique({ where: { code: "IMPAR-IND-001" } });
  const seedHealthPlan = planIndividual
    ? await prisma.healthPlan.upsert({
        where: { planNumber: "IMPAR-IND-SEED-0001" },
        update: {},
        create: {
          productId: planIndividual.id,
          holderPatientId: p2.id,
          planNumber: "IMPAR-IND-SEED-0001",
          startDate: monthOffset(6, 1),
          active: true,
        },
      })
    : null;

  // The two "completed" appointments above are the natural candidates for a real appointmentId
  // link on an invoice — in the running app this is exactly when an invoice auto-generates, but
  // that side effect lives in AppointmentsService.updateStatus(), not triggered by seeding rows
  // directly via Prisma, so it's created here explicitly instead.
  const completedAppt1 = await prisma.appointment.findFirst({ where: { patientId: p4.id, status: "completed" } });
  const completedAppt2 = await prisma.appointment.findFirst({ where: { patientId: p5.id, status: "completed" } });

  if ((await prisma.invoice.count()) === 0) {
    const dentService  = services.find((s) => s.code === "DENT-CONS")!;
    const ultraService = services.find((s) => s.code === "EXAM-ULTRA")!;

    const invoicesData: {
      num: string; patientId: string; appointmentId?: string; healthPlanId?: string;
      serviceId: string; serviceName: string; unitPrice: number;
      status: "paid" | "partially_paid" | "issued" | "overdue";
      issuedAt: Date; dueDate: Date; paid: number;
    }[] = [
      { num: "0001", patientId: p4.id, appointmentId: completedAppt1?.id,       serviceId: consGeral.id,     serviceName: "Consulta Geral",         unitPrice: 1500, status: "paid",           issuedAt: monthOffset(0, 3),  dueDate: monthOffset(0, 10),  paid: 1500 },
      { num: "0002", patientId: p5.id, appointmentId: completedAppt2?.id,       serviceId: consEsp.id,       serviceName: "Consulta Especialidade", unitPrice: 2500, status: "partially_paid", issuedAt: monthOffset(0, 4),  dueDate: monthOffset(0, 18),  paid: 1000 },
      { num: "0003", patientId: p2.id, healthPlanId: seedHealthPlan?.id,        serviceId: consGeral.id,     serviceName: "Consulta Geral",         unitPrice: 1500, status: "paid",           issuedAt: monthOffset(1, 5),  dueDate: monthOffset(1, 15),  paid: 1500 },
      { num: "0004", patientId: p1.id,                                          serviceId: examLab.id,       serviceName: "Exame Laboratorial",     unitPrice: 800,  status: "paid",           issuedAt: monthOffset(1, 8),  dueDate: monthOffset(1, 18),  paid: 800  },
      { num: "0005", patientId: p3.id,                                          serviceId: dentService.id,   serviceName: "Consulta Dentária",      unitPrice: 2000, status: "issued",         issuedAt: monthOffset(0, 1),  dueDate: monthOffset(-1, 1),  paid: 0    },
      { num: "0006", patientId: p2.id, healthPlanId: seedHealthPlan?.id,        serviceId: ultraService.id,  serviceName: "Ecografia",              unitPrice: 3500, status: "overdue",        issuedAt: monthOffset(2, 1),  dueDate: monthOffset(1, 15),  paid: 0    },
      { num: "0007", patientId: p5.id,                                          serviceId: consGeral.id,     serviceName: "Consulta Geral",         unitPrice: 1500, status: "overdue",        issuedAt: monthOffset(2, 10), dueDate: monthOffset(1, 25),  paid: 0    },
    ];

    for (const inv of invoicesData) {
      await prisma.invoice.create({
        data: {
          invoiceNumber: `INV-${now.getFullYear()}-${inv.num}`,
          patientId: inv.patientId,
          ...(inv.appointmentId ? { appointmentId: inv.appointmentId } : {}),
          ...(inv.healthPlanId ? { healthPlanId: inv.healthPlanId } : {}),
          status: inv.status,
          subtotal: inv.unitPrice,
          total: inv.unitPrice,
          amountPaid: inv.paid,
          issuedAt: inv.issuedAt,
          dueDate: inv.dueDate,
          items: { create: [{ serviceId: inv.serviceId, description: inv.serviceName, quantity: 1, unitPrice: inv.unitPrice, total: inv.unitPrice }] },
          ...(inv.paid > 0
            ? { payments: { create: [{ amount: inv.paid, method: "cash" as const, paidAt: inv.issuedAt }] } }
            : {}),
        },
      });
    }
  }

  // ─── Cabo Verde Public Holidays ────────────────────────────────────────────
  const year = new Date().getFullYear();
  const holidays = [
    { date: `${year}-01-01`, name: "Ano Novo" },
    { date: `${year}-01-20`, name: "Dia dos Heróis Nacionais" },
    { date: `${year}-03-08`, name: "Dia Internacional da Mulher" },
    { date: `${year}-04-18`, name: "Boa Sexta-feira" },
    { date: `${year}-05-01`, name: "Dia do Trabalhador" },
    { date: `${year}-06-01`, name: "Dia da Criança" },
    { date: `${year}-07-05`, name: "Dia da Independência Nacional" },
    { date: `${year}-08-15`, name: "Assunção de Nossa Senhora" },
    { date: `${year}-11-01`, name: "Dia de Todos os Santos" },
    { date: `${year}-12-25`, name: "Natal" },
  ];

  for (const h of holidays) {
    await prisma.publicHoliday.upsert({
      where: { date_countryCode: { date: new Date(h.date), countryCode: "CV" } },
      update: {},
      create: { date: new Date(h.date), name: h.name, countryCode: "CV" },
    });
  }

  // ─── Parametrizações ───────────────────────────────────────────────────────
  // ponytail: group-level idempotency — skip entire group if it already has rows
  async function seedGroup(nome: string, rows: { valor: string; codigo?: string; descricao?: string }[]) {
    const existing = await prisma.parametrizacao.count({ where: { nome, deletedAt: null } });
    if (existing > 0) return 0;
    await prisma.parametrizacao.createMany({
      data: rows.map((r, i) => ({ nome, valor: r.valor, codigo: r.codigo ?? null, descricao: r.descricao ?? null, ordem: (i + 1) * 10 })),
    });
    return rows.length;
  }

  const paramCounts = await Promise.all([
    seedGroup("FUNCAO", [
      { valor: "Médico/a",                    codigo: "doctor"       },
      { valor: "Enfermeiro/a",                codigo: "nurse"        },
      { valor: "Recepcionista",               codigo: "receptionist" },
      { valor: "Técnico/a de Laboratório",    codigo: "lab_tech"     },
      { valor: "Administrador/a",             codigo: "admin"        },
    ]),
    seedGroup("ESPECIALIDADE", [
      { valor: "Clínica Geral",   codigo: "CLINICA-GERAL" },
      { valor: "Pediatria",       codigo: "PEDIATRIA"     },
      { valor: "Cardiologia",     codigo: "CARDIOLOGIA"   },
      { valor: "Ginecologia",     codigo: "GINECOLOGIA"   },
      { valor: "Medicina Interna",codigo: "MED-INTERNA"   },
      { valor: "Ortopedia",       codigo: "ORTOPEDIA"     },
      { valor: "Dermatologia",    codigo: "DERMATOLOGIA"  },
      { valor: "Oftalmologia",    codigo: "OFTALMOLOGIA"  },
      { valor: "Medicina Dentária",codigo: "DENTARIA"     },
    ]),
    seedGroup("TIPO_EXAME", [
      { valor: "Análise Laboratorial", codigo: "lab"   },
      { valor: "Imagem",               codigo: "image" },
      { valor: "Cardiologia",          codigo: "ecg"   },
      { valor: "Outro",                codigo: "other" },
    ]),
    seedGroup("TIPO_CONSULTA", [
      { valor: "Rotina",          codigo: "routine"   },
      { valor: "Pós-Operatório",  codigo: "post_op"   },
      { valor: "Seguimento",      codigo: "follow_up" },
      { valor: "Urgente",         codigo: "urgent"    },
    ]),
    seedGroup("TIPO_PLANO_SAUDE", [
      { valor: "Familiar",    codigo: "familiar"   },
      { valor: "Corporativo", codigo: "corp"       },
      { valor: "Particular",  codigo: "particular" },
    ]),
    seedGroup("PROFILE_SETTINGS", [
      { valor: "Administrador/a", codigo: "admin"        },
      { valor: "Médico/a",        codigo: "doctor"       },
      { valor: "Enfermeiro/a",    codigo: "nurse"        },
      { valor: "Recepcionista",   codigo: "receptionist" },
      { valor: "Técnico/a Lab.",  codigo: "lab_tech"     },
    ]),
    // codigo = service UUID so the appointment form's serviceId maps directly
    seedGroup("TIPO_SERVICO", [
      { valor: "Consulta Geral",          codigo: services.find(s => s.code === "CONS-GERAL")?.id   },
      { valor: "Consulta Especialidade",  codigo: services.find(s => s.code === "CONS-ESP")?.id     },
      { valor: "Consulta Dentária",       codigo: services.find(s => s.code === "DENT-CONS")?.id    },
      { valor: "Exame Laboratorial",      codigo: services.find(s => s.code === "EXAM-LAB")?.id     },
      { valor: "Ecografia",               codigo: services.find(s => s.code === "EXAM-ULTRA")?.id   },
      { valor: "Visita Domiciliária",     codigo: services.find(s => s.code === "HOME-VISIT")?.id   },
    ]),
  ]);

  const totalParams = paramCounts.reduce((a, b) => a + b, 0);

  console.warn(
    `Seeded 3 companies, 8 health plan products, ${services.length} services, ${rooms.length} rooms, 7 staff, 6 patients, ${appointmentsData.length} appointments, ${holidays.length} public holidays, ${totalParams} parametrizações, Financeiro data (expenses/income/invoices).`
  );
  console.warn(`All staff accounts log in with password: ${SEED_PASSWORD}`);
  console.warn(`Admin: capjacobvicente@gmail.com`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
