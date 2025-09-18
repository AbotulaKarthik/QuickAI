import OpenAI from "openai";
import sql from "../configs/db.js";
import { clerkClient } from "@clerk/express";
import axios from "axios";
import {v2 as cloudinary} from 'cloudinary'
import fs from 'fs'
import FormData from 'form-data'
import pdf from 'pdf-parse/lib/pdf-parse.js'


const AI = new OpenAI({
    apiKey: process.env.GEMINI_API_KEY,
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai/"
});

/// generating article  --------------------------------------------------------------------
export const generateArticle = async (req, res) => {
    try {
        const {userId} = req.auth()
        const {prompt, length} = req.body
        const plan = req.plan
        const free_usage = req.free_usage

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium.'})
        }

        const response = await AI.chat.completions.create({
            model: "gemini-2.0-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: length,
        });

        const content = response.choices[0].message.content;

        await sql` INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'article')`

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata:{
                    free_usage: free_usage + 1 
                }
            })
        }

        res.json({success: true, content})

    } catch (error) {
        console.log(error.response?.status, error.response?.data);
        res.json({success: false, message: error.message})
    }
}



/// generating Blog Title --------------------------------------------------------------------
export const generateBlogTitle = async (req, res) => {
    try {
        const {userId} = req.auth()
        const {prompt} = req.body
        const plan = req.plan
        const free_usage = req.free_usage

        if(plan !== 'premium' && free_usage >= 10){
            return res.json({success: false, message: 'Free usage limit reached. Please upgrade to premium.'})
        }

        const response = await AI.chat.completions.create({
            model: "gemini-2.0-flash",
            messages: [
                {
                    role: "user",
                    content: prompt,
                },
            ],
            temperature: 0.7,
            max_tokens: 100,
        });

        const content = response.choices[0].message.content;

        await sql` INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${prompt}, ${content}, 'blog-title')`

        if(plan !== 'premium'){
            await clerkClient.users.updateUserMetadata(userId,{
                privateMetadata:{
                    free_usage: free_usage + 1 
                }
            })
        }

        res.json({success: true, content})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}



/// generating Images --------------------------------------------------------------------
export const generateImage = async (req, res) => {
    try {
        const {userId} = req.auth()
        const {prompt,publish} = req.body
        const plan = req.plan

        if(plan !== 'premium'){
            return res.json({success: false, message: 'This feature is available for premium users only. Please upgrade to enjoy the features.'})
        }

        const formData = new FormData()
        formData.append('prompt', prompt)
        const {data} = await axios.post("https://clipdrop-api.co/text-to-image/v1",formData,{
            headers: {
                'x-api-key': process.env.CLIPDROP_API_KEY
            },
            responseType: "arraybuffer"
        })

        const base64Image = `data:image/png;base64,${Buffer.from(data,'binary').toString('base64')}`

        const {secure_url} = await cloudinary.uploader.upload(base64Image)

        await sql` INSERT INTO creations (user_id, prompt, content, type, publish) VALUES (${userId}, ${prompt}, ${secure_url}, 'image',${publish ?? false})`

        res.json({success: true, content: secure_url})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}


/// Remove Background --------------------------------------------------------------------
export const removeImageBackground = async (req, res) => {
  try {
    const { userId } = req.auth();
    const plan = req.plan;
    const image = req.file;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is available for premium users only. Please upgrade to enjoy the features.",
      });
    }

    const formData = new FormData();
    formData.append("image_file", image.buffer, image.originalname);

    const response = await axios.post(
      "https://clipdrop-api.co/remove-background/v1",
      formData,
      {
        headers: {
          "x-api-key": process.env.CLIPDROP_API_KEY,
          ...formData.getHeaders(),
        },
        responseType: "arraybuffer",
      }
    );

    const base64Image = `data:image/png;base64,${Buffer.from(response.data).toString("base64")}`;
    const { secure_url } = await cloudinary.uploader.upload(base64Image);

    await sql`
      INSERT INTO creations (user_id, prompt, content, type)
      VALUES (${userId}, ${"Remove background from image"}, ${secure_url}, 'image')
    `;

    res.json({ success: true, content: secure_url });
  } catch (error) {
    console.error(error.response?.data || error.message);
    res.json({ success: false, message: error.message });
  }
};



/// Remove Image object --------------------------------------------------------------------
export const removeImageObject = async (req, res) => {
    try {
        const {userId} = req.auth()
        const {object} = req.body
        const image = req.file
        const plan = req.plan

        if(plan !== 'premium'){
            return res.json({success: false, message: 'This feature is available for premium users only. Please upgrade to enjoy the features.'})
        }

        const {public_id} = await cloudinary.uploader.upload(image.path)

        const imageUrl = cloudinary.url(public_id, {
            transformation: [{effect:`gen_remove:${object}`}],
            resource_type: "image",
        })

        await sql` INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${`Removed ${object} from image`}, ${imageUrl}, 'image')`

        res.json({success: true, content: imageUrl})

    } catch (error) {
        console.log(error.message)
        res.json({success: false, message: error.message})
    }
}


/// Review Resume --------------------------------------------------------------------
export const resumeReview = async (req, res) => {
  try {
    const { userId } = req.auth();
    const plan = req.plan;

    if (plan !== "premium") {
      return res.json({
        success: false,
        message: "This feature is available for premium users only.",
      });
    }

    if (!req.body.resume) {
      return res.json({ success: false, message: "No file uploaded" });
    }

    const base64Data = req.body.resume.split(",")[1] || req.body.resume;
    const buffer = Buffer.from(base64Data, "base64");

    if (buffer.length > 5 * 1024 * 1024) {
      return res.json({ success: false, message: "File size should be <5MB" });
    }

    const pdfData = await pdf(buffer);

    const prompt = `Review my resume and suggest improvements. Here is the content: ${pdfData.text}`;

    const response = await AI.chat.completions.create({
      model: "gemini-2.0-flash",
      messages: [{ role: "user", content: prompt }],
      temperature: 0.7,
      max_tokens: 1000,
    });

    const content = response.choices[0].message.content;

    await sql`INSERT INTO creations (user_id, prompt, content, type) VALUES (${userId}, ${"Review the uploaded resume"}, ${content}, ${'resume-review'})`;

    res.json({ success: true, content });
  } catch (error) {
    console.log(error.message);
    res.json({ success: false, message: error.message });
  }
};