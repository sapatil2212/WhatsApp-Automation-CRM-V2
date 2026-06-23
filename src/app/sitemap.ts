import { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const baseUrl = "https://chatnexgen.online";
  
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
  ];

  return routes.map((route) => ({
    url: `${baseUrl}${route}`,
    lastModified: new Date(),
    changeFrequency: "weekly",
    priority: route === "" ? 1.0 : route.includes("-policy") || route.includes("-conditions") ? 0.3 : 0.8,
  }));
}
