export interface DemoPersona {
  name: string;
  email: string;
  role: "ADMIN" | "OPS" | "VIEWER";
  blurb: string;
}

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    name: "Dana Alvarez",
    email: "dana@lakeviewhealth.example",
    role: "ADMIN",
    blurb: "Connector config, chaos panel, users, audit log",
  },
  {
    name: "Marcus Webb",
    email: "marcus@lakeviewhealth.example",
    role: "OPS",
    blurb: "Retry jobs, acknowledge/resolve incidents, regenerate summaries",
  },
  {
    name: "Priya Nair",
    email: "priya@lakeviewhealth.example",
    role: "VIEWER",
    blurb: "Read-only dashboards and incident history",
  },
];
