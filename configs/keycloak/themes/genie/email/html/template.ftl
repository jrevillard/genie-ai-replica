<#macro emailLayout>
<#assign rtlLocales = ["ar","he","fa","ur"]>
<#assign isRtl = rtlLocales?seq_contains(locale.language)>
<html lang="${locale.language}" dir="${isRtl?string('rtl','ltr')}">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${subject!"GENIE.AI"}</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            background-color: #f5f7fa;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            font-size: 14px;
            line-height: 1.6;
            color: #333333;
        }
        .email-container {
            max-width: 600px;
            margin: 0 auto;
            background-color: #ffffff;
            border-radius: 8px;
            overflow: hidden;
            box-shadow: 0 2px 8px rgba(0, 0, 0, 0.05);
        }
        .header {
            background: linear-gradient(135deg, #4E97D1 0%, #3a7da0 100%);
            padding: 24px;
            text-align: center;
        }
        .header img {
            max-width: 120px;
            max-height: 40px;
        }
        .header .brand-name {
            color: #ffffff;
            font-size: 20px;
            font-weight: 600;
            margin-top: 8px;
        }
        .content {
            padding: 32px;
        }
        .content h1 {
            font-size: 18px;
            font-weight: 600;
            color: #333333;
            margin: 0 0 16px;
        }
        .content p {
            margin: 0 0 16px;
            color: #555555;
        }
        .content .highlight {
            color: #4E97D1;
            font-weight: 500;
        }
        .button {
            display: inline-block;
            padding: 12px 24px;
            background-color: #4E97D1;
            color: #ffffff !important;
            text-decoration: none;
            border-radius: 6px;
            font-weight: 600;
            text-align: center;
        }
        .button:hover {
            background-color: #3a7da0;
        }
        .footer {
            background-color: #f5f7fa;
            padding: 20px 32px;
            text-align: center;
            border-top: 1px solid #dde1e6;
        }
        .footer p {
            margin: 0;
            color: #888888;
            font-size: 12px;
            line-height: 1.5;
        }
        .footer .itu-name {
            font-weight: 600;
            color: #555555;
        }
    </style>
</head>
<body>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0">
    <tr>
        <td align="center" style="padding: 24px 0;">
            <table class="email-container" role="presentation" width="600" cellpadding="0" cellspacing="0">
                <tr>
                    <td class="header">
                        <img src="cid:logo.png" alt="GENIE.AI" style="display:block;">
                        <div class="brand-name">GENIE.AI</div>
                    </td>
                </tr>
                <tr>
                    <td class="content">
                        <#nested>
                    </td>
                </tr>
                <tr>
                    <td class="footer">
                        <p class="itu-name">International Telecommunication Union (ITU)</p>
                        <p>Place des Nations, CH-1211 Geneva, Switzerland</p>
                        <p style="margin-top: 8px;">This email was sent by GENIE.AI. Please do not reply to this email.</p>
                    </td>
                </tr>
            </table>
        </td>
    </tr>
</table>
</body>
</html>
</#macro>
