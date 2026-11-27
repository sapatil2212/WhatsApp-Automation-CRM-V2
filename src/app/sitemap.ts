import { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = SITE_URL;
  
  const routes = [
    "",
    "/about-us",
    "/contact-us",
    "/privacy-policy",
    "/terms-and-conditions",
    "/refund-policy",
    "/features",
    "/pricing",
    "/ai-automation",
    "/shared-team-inbox",
    "/crm",
    "/analytics",
    "/enterprise",
    "/security",
    "/customer-stories",
    "/data-deletion",
    "/whatsapp-marketing",
    "/integrations",
    "/book-demo",
    "/blog",
    "/careers",
    "/api-docs",
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: route === "" ? 1.0 : route.includes("-policy") || route.includes("-conditions") ? 0.3 : 0.8,
  }));
}
