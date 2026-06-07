import React from "react";
import Spacer from "@components/Spacer";
import { useStyles } from "./Posts";
import { HELP_DOCUMENT, SITE_NAME, LEGACY_PLATFORM_NAME } from "../../config/config";

const VPAT_LINK = `${process.env.PUBLIC_URL}/static/documents/OATutor_Sec508_WCAG.pdf`

const About = () => {
    const classes = useStyles()
    const currentYear = new Date().getFullYear();

    return <>
        <h2>
            About {SITE_NAME}
        </h2>
        <p>
            {SITE_NAME} is an explainable AI (XAI) research platform for tutoring: it traces how
            agents and learners move through <strong>propositions</strong> (statements from problems
            and hints), builds reasoning graphs with transition probabilities, and supports
            multi-agent training and evaluation on real curriculum content.
        </p>
        <p>
            The adaptive tutoring core, Bayesian Knowledge Tracing (BKT), problem pool, and lesson
            structure come from {LEGACY_PLATFORM_NAME} — the open-source Intelligent Tutoring System
            from the CAHL Research Lab at UC Berkeley School of Education.
        </p>

        <h3>Question Input Types & Shortcuts</h3>

        To learn more about how to fill in and submit assignments,<span> </span>
        <a href={HELP_DOCUMENT} target={"_blank"} rel={"noreferrer"}>visit our help document</a>.

        <h3>Contributors</h3>
        
        {LEGACY_PLATFORM_NAME} was created and developed by a dedicated team from the Computational
        Approaches to Human Learning (CAHL) Research Lab at the UC Berkeley School of Education.
        This XAI layer extends that platform with proposition-based interpretability and agent labs.
        
        <h3>Learn more</h3>
        <ul>
            <li>Visit <a href="https://www.oatutor.io/" target={"_blank"} rel={"noreferrer"}>https://www.oatutor.io/</a> for the original {LEGACY_PLATFORM_NAME} project, mission, and documentation.</li>
            <li>Read the <a href="https://dl.acm.org/doi/10.1145/3544548.3581574" target={"_blank"} rel={"noreferrer"}>OATutor research paper</a> for the scientific foundation of the underlying tutoring system.</li>
        </ul>

        <h3>Accessibility Standards</h3>

        <p>
            This platform strives to ensure an accessible experience for all users, regardless of
            disabilities. The site is built with up-to-date HTML5 and CSS3 standards while complying
            with W3C Web Accessibility Guidelines (WCAG) and Section 508 guidelines inherited from
            the {LEGACY_PLATFORM_NAME} codebase.
        </p>

        <p className={classes["pt-2"]}>
            The Voluntary Product Accessibility Template, or VPAT, is a tool that administrators and
            decision-makers can use to evaluate conformance with accessibility standards under
            Section 508 of the Rehabilitation Act.
        </p>

        <p className={classes["pt-2"]}>
            You may read the most recent Voluntary Product Accessibility Template at this
            url:<span> </span>
            <a href={VPAT_LINK} target={"_blank"} rel={"noreferrer"}>{VPAT_LINK.match(/\/[^/]*$/)[0].substr(1)}</a>
        </p>

        <Spacer height={24 * 1}/>

        <sub>
            <p>{LEGACY_PLATFORM_NAME} code is licensed under an MIT Open Source License, with adaptive learning content under CC BY 4.0.</p> 
            <p>© {currentYear}, CAHL Research Lab, UC Berkeley School of Education.</p>
        </sub>
    </>
}

export default About
