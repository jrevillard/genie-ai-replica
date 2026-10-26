<#--
  GENIE.AI email layout.

  The brand surfaces follow the same rules as the web app: the header is
  a pale wash of the brand with the brand's ink on it, the content sits
  on a white card over the pale page ground, and the wave band closes
  the card.

  The images are fetched from the theme's own resources by URL. Keycloak
  attaches nothing to an email, so a `cid:` reference resolves to a
  broken image in every mail client.
-->
<#macro emailLayout>
<#assign rtlLocales = ["ar","he","fa","ur"]>
<#assign isRtl = rtlLocales?seq_contains(locale.language)>
<html lang="${locale.language}" dir="${isRtl?string('rtl','ltr')}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject!"GENIE.AI"}</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f7fd;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.6;color:#344049;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td align="center" style="padding:24px 0;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 16px 40px rgba(20,30,60,0.14);">
                <tr>
                    <td style="background-color:#ddecff;padding:28px 24px;text-align:center;">
                        <#if url??>
                            <img src="${url.resourcesUrl}/img/logo.png" alt="GENIE.AI" style="display:block;max-width:72px;max-height:72px;margin:0 auto;border-radius:12px;">
                        </#if>
                        <div style="color:#000d64;font-size:22px;font-weight:700;letter-spacing:0.08em;margin-top:12px;">GENIE.AI</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:32px;">
                        <#nested>
                    </td>
                </tr>
                <#if url??>
                    <tr>
                        <td style="padding:0 32px;line-height:0;">
                            <img src="${url.resourcesUrl}/img/genie-bottom-waves.png" alt="" style="display:block;width:100%;height:auto;">
                        </td>
                    </tr>
                </#if>
                <tr>
                    <td style="background-color:#f9fbfd;padding:20px 32px;text-align:center;border-top:1px solid #bdc5cb;">
                        <p style="margin:0;font-weight:600;color:#344049;">International Telecommunication Union (ITU)</p>
                        <p style="margin:0;color:#818b91;">Place des Nations, CH-1211 Geneva, Switzerland</p>
                        <p style="margin:8px 0 0 0;color:#a0a9b0;font-size:12px;line-height:1.5;">This email was sent by GENIE.AI. Please do not reply to this email.</p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
</#macro>
