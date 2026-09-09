import { readComputeProjects } from "@/lib/telligence/project.server";
import type { MetadataRoute } from "next";

export const revalidate = 3600;
const siteOrigin = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3002";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const entries: MetadataRoute.Sitemap = ["/", "/discover", "/how-it-works", "/create"].map(
    (path) => ({
      url: new URL(path, siteOrigin).href,
      changeFrequency: path === "/" ? "daily" : "monthly",
      priority: path === "/" ? 1 : 0.6,
    }),
  );
  const projects = await readComputeProjects();
  for (const project of projects)
    entries.push({
      url: new URL(`/compute/${encodeURIComponent(project.id)}`, siteOrigin).href,
      changeFrequency: "daily",
      priority: 0.8,
    });
  return entries;
}
