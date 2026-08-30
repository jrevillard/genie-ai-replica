<#macro emailLayout>
<#assign rtlLocales = ["ar","he","fa","ur"]>
<#assign isRtl = rtlLocales?seq_contains(locale.language)>
<html lang="${locale.language}" dir="${isRtl?string('rtl','ltr')}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject!"GENIE.AI"}</title>
</head>
<body style="margin:0;padding:0;background-color:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,sans-serif;font-size:14px;line-height:1.6;color:#1e293b;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td align="center" style="padding:24px 0;">
            <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background-color:#ffffff;border-radius:8px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.05);">
                <tr>
                    <td style="background:linear-gradient(135deg,#2b4acb 0%,#1e3a8a 100%);padding:24px;text-align:center;">
                        <img src="cid:logo.png" alt="GENIE.AI" style="display:block;max-width:120px;max-height:40px;">
                        <div style="color:#ffffff;font-size:20px;font-weight:600;margin-top:8px;">GENIE.AI</div>
                    </td>
                </tr>
                <tr>
                    <td style="padding:32px;">
                        <#nested>
                    </td>
                </tr>
                <tr>
                    <td style="background-color:#f8fafc;padding:20px 32px;text-align:center;border-top:1px solid #cbd5e1;">
                        <p style="margin:0;font-weight:600;color:#475569;">International Telecommunication Union (ITU)</p>
                        <p style="margin:0;color:#475569;">Place des Nations, CH-1211 Geneva, Switzerland</p>
                        <p style="margin:8px 0 0 0;color:#888888;font-size:12px;line-height:1.5;">This email was sent by GENIE.AI. Please do not reply to this email.</p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
</#macro>
