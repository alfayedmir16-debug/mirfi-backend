import nodemailer from 'nodemailer';

// Sanitize SMTP configurations from environment variables
const getSMTPConfig = () => {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').replace(/['"]/g, '').trim();
  const port = parseInt((process.env.SMTP_PORT || '587').replace(/['"]/g, '').trim());
  const user = (process.env.SMTP_USER || '').replace(/['"]/g, '').trim();
  const pass = (process.env.SMTP_PASS || '').replace(/['"]/g, '').replace(/\s+/g, '').trim(); // Remove all quotes and spaces

  return { host, port, user, pass };
};

export const sendResetCodeEmail = async (email: string, code: string, type: 'reset' | 'delete' = 'reset'): Promise<boolean> => {
  const { host, port, user, pass } = getSMTPConfig();

  console.log('\n--- SMTP DEBUG LOGS ---');
  console.log('Host:', JSON.stringify(host));
  console.log('Port:', port);
  console.log('User:', JSON.stringify(user));
  console.log('Pass:', JSON.stringify(pass));
  console.log('Pass Length:', pass.length);
  console.log('------------------------\n');

  if (!user || !pass) {
    console.warn('⚠️ SMTP credentials are not set in .env. Please configure SMTP_USER and SMTP_PASS.');
    throw new Error('Email sending service is currently not configured on this server. Please set SMTP_USER and SMTP_PASS in .env.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    auth: {
      user,
      pass,
    },
    tls: {
      rejectUnauthorized: false // Allow secure connections on local environments
    }
  });

  const isDeletion = type === 'delete';
  const mailOptions = {
    from: `"MirFi Security" <${user}>`,
    to: email,
    subject: isDeletion ? '⚠️ MirFi - Account Deletion Request' : '🔑 MirFi - Reset Your Password',
    text: `Hello,\n\n${isDeletion ? 'Your 6-digit account deletion verification code is:' : 'Your 6-digit password reset verification code is:'} ${code}\n\nThis code will expire in ${isDeletion ? '10' : '15'} minutes.\n\n${isDeletion ? 'If you did not request this, please ignore this email. Your account will remain safe.' : 'If you did not request this, please ignore this email.'}\n\nBest regards,\nMirFi Team`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 30px; border: 1px solid #e0e0e0; border-radius: 16px; background-color: #ffffff; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
        <div style="text-align: center; margin-bottom: 30px;">
          <h1 style="color: ${isDeletion ? '#EF4444' : '#4F46E5'}; margin: 0; font-size: 32px; font-weight: 800; letter-spacing: -1px;">MirFi</h1>
          <p style="color: #888888; font-size: 14px; margin-top: 5px;">${isDeletion ? 'Account Security' : 'Secure Account Recovery'}</p>
        </div>
        <hr style="border: 0; border-top: 1px solid #f0f0f0; margin-bottom: 30px;" />
        <h2 style="color: #1F2937; margin-top: 0; font-size: 20px; font-weight: 700;">${isDeletion ? 'Account Deletion Request' : 'Reset Your Password'}</h2>
        <p style="color: #4B5563; font-size: 16px; line-height: 24px; margin-bottom: 25px;">
          ${isDeletion 
            ? `We received a request to delete your MirFi account. Use the verification code below to confirm this action. <strong>This action cannot be undone.</strong> This code is valid for <strong>10 minutes</strong>.`
            : `We received a request to reset the password for your MirFi account. Use the verification code below to proceed with your password reset. This code is valid for <strong>15 minutes</strong>.`
          }
        </p>
        <div style="text-align: center; margin: 35px 0;">
          <div style="display: inline-block; background-color: ${isDeletion ? '#FEE2E2' : '#F3F4F6'}; border: 1px dashed ${isDeletion ? '#EF4444' : '#4F46E5'}; border-radius: 12px; padding: 15px 40px; letter-spacing: 6px; font-size: 36px; font-weight: 800; color: ${isDeletion ? '#EF4444' : '#4F46E5'};">
            ${code}
          </div>
        </div>
        <p style="color: #EF4444; font-size: 14px; margin-bottom: 30px; font-weight: 500;">
          ${isDeletion 
            ? '⚠️ If you did not request account deletion, please ignore this email. Your account will remain safe.'
            : '⚠️ If you did not request a password reset, please ignore this email or contact support if you have concerns.'
          }
        </p>
        <hr style="border: 0; border-top: 1px solid #f0f0f0; margin-bottom: 25px;" />
        <div style="text-align: center; color: #9CA3AF; font-size: 12px; line-height: 18px;">
          <p style="margin: 0;">This is an automated security message from MirFi. Please do not reply directly to this email.</p>
          <p style="margin: 5px 0 0 0;">&copy; 2026 MirFi Inc. All rights reserved.</p>
        </div>
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  return true;
};

export const sendSupportTicketEmail = async (data: {
  username: string;
  email: string;
  category: string;
  description: string;
  images: string[];
}): Promise<boolean> => {
  const { host, port, user, pass } = getSMTPConfig();

  if (!user || !pass) {
    throw new Error('Email service not configured.');
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    auth: { user, pass },
    tls: { rejectUnauthorized: false }
  });

  const mailOptions = {
    from: `"MirFi Support" <${user}>`,
    to: user, // Send to yourself
    replyTo: data.email,
    subject: `🛠️ Support Ticket: ${data.category} from @${data.username}`,
    html: `
      <div style="font-family: sans-serif; max-width: 600px; margin: auto; padding: 20px; border: 1px solid #eee; border-radius: 10px;">
        <h2 style="color: #4F46E5;">New Support Ticket</h2>
        <p><strong>Username:</strong> @${data.username}</p>
        <p><strong>Email:</strong> ${data.email}</p>
        <p><strong>Category:</strong> ${data.category}</p>
        <hr/>
        <p><strong>Description:</strong></p>
        <p style="white-space: pre-wrap; background: #f9f9f9; padding: 15px; border-radius: 5px;">${data.description}</p>
        ${data.images.length > 0 ? `
          <p><strong>Attachments:</strong> ${data.images.length} images provided.</p>
          <div style="display: flex; flex-wrap: wrap; gap: 10px;">
            ${data.images.map((img, i) => `<img src="${img}" style="width: 150px; height: 150px; object-fit: cover; border-radius: 5px; margin: 5px;" alt="attachment-${i}"/>`).join('')}
          </div>
        ` : ''}
      </div>
    `,
  };

  await transporter.sendMail(mailOptions);
  return true;
};

