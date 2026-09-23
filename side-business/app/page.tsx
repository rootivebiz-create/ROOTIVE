import type { Metadata } from "next";
import { BusinessInfo } from "@/components/landing/business-info";
import { Comparison } from "@/components/landing/comparison";
import { Deadlines } from "@/components/landing/deadlines";
import { Faq, landingFaq } from "@/components/landing/faq";
import { Features } from "@/components/landing/features";
import { FinalCta } from "@/components/landing/final-cta";
import { Flow } from "@/components/landing/flow";
import { Hero } from "@/components/landing/hero";
import { Maker } from "@/components/landing/maker";
import { Pains } from "@/components/landing/pains";
import { Pricing } from "@/components/landing/pricing";
import { JsonLd, regNoText } from "@/components/landing/section";
import { Trust } from "@/components/landing/trust";
import { CONTACT, PLANS, SITE, businessInfo, type BusinessInfo as Info } from "@/site.config";

const OG_TITLE = `${SITE.name}｜${SITE.tagline}`;

export const metadata: Metadata = {
  description: SITE.description,
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    locale: SITE.locale,
    siteName: SITE.name,
    url: "/",
    title: OG_TITLE,
    description: SITE.description,
  },
};

/** 事業者の構造化データ。設定されている項目だけを入れる（無い情報は作らない） */
function businessLd(info: Info) {
  const url = `${SITE.url}/`;
  return {
    "@context": "https://schema.org",
    "@type": "ProfessionalService",
    "@id": `${url}#business`,
    name: SITE.name,
    url,
    description: SITE.description,
    areaServed: { "@type": "Country", name: "日本" },
    serviceType: "業務委託ドライバーの支払明細・振込データ・利益の集計の仕組みづくり",
    ...(info.ownerName ? { founder: { "@type": "Person", name: info.ownerName } } : {}),
    ...(info.address ? { address: info.address } : {}),
    ...(info.phone ? { telephone: info.phone } : {}),
    ...(CONTACT.email ? { email: CONTACT.email } : {}),
    ...(info.invoiceRegNo ? { taxID: regNoText(info.invoiceRegNo) } : {}),
    hasOfferCatalog: {
      "@type": "OfferCatalog",
      name: "料金（税抜）",
      itemListElement: PLANS.map((p) => ({
        "@type": "Offer",
        name: p.name,
        description: p.forWhom,
        priceCurrency: "JPY",
        price: p.initialYen,
        priceSpecification: [
          {
            "@type": "PriceSpecification",
            name: p.monthlyYen > 0 ? "初期費用" : "費用",
            price: p.initialYen,
            priceCurrency: "JPY",
            valueAddedTaxIncluded: false,
          },
          ...(p.monthlyYen > 0
            ? [
                {
                  "@type": "UnitPriceSpecification",
                  name: "月額",
                  price: p.monthlyYen,
                  priceCurrency: "JPY",
                  unitCode: "MON",
                  valueAddedTaxIncluded: false,
                },
              ]
            : []),
        ],
      })),
    },
  };
}

export default function HomePage() {
  const info = businessInfo();
  const faq = landingFaq();
  const faqLd = {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: faq.map((f) => ({ "@type": "Question", name: f.q, acceptedAnswer: { "@type": "Answer", text: f.a } })),
  };

  return (
    <>
      <JsonLd data={businessLd(info)} />
      <JsonLd data={faqLd} />
      <Hero />
      <Pains />
      <Deadlines />
      <Features />
      <Maker />
      <Pricing invoiceRegNo={info.invoiceRegNo} />
      <Comparison />
      <Trust />
      <Flow />
      <Faq items={faq} />
      <BusinessInfo info={info} email={CONTACT.email} />
      <FinalCta bookingUrl={CONTACT.bookingUrl} lineUrl={CONTACT.lineUrl} />
    </>
  );
}
